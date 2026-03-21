import xml2js from 'xml2js';
import { makeLogger } from '../utils/logger';
import env from '../config/env';

/**
 * Parse XMLTV EPG content into a channel-keyed object.
 */
export async function parseEPG(content: string, log?: ReturnType<typeof makeLogger>) {
    if (Buffer.byteLength(content, 'utf8') > env.EPG_MAX_BYTES) {
        const sizeMb = (Buffer.byteLength(content, 'utf8') / 1024 / 1024).toFixed(1);
        if (log) log.warn(`[EPG] Content too large (${sizeMb} MB), skipping`);
        return {};
    }

    const start = Date.now();
    try {
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(content);
        const epgData: Record<string, any[]> = {};
        if (result.tv && result.tv.programme) {
            const cutoff = Date.now() - 3600 * 1000; // 1 hour ago
            const nowTime = Date.now();
            let eventCount = 0;
            for (const prog of result.tv.programme) {
                // Yield every 5000 programmes to keep the event loop responsive
                if (++eventCount % 5000 === 0) {
                    await new Promise<void>(resolve => setImmediate(resolve));
                }
                const stopDate = parseEPGTime(prog.$.stop);
                if (stopDate.getTime() < cutoff) continue;

                const startDate = parseEPGTime(prog.$.start);

                const ch = prog.$.channel;
                if (!epgData[ch]) epgData[ch] = [];
                epgData[ch].push({
                    start: startDate.getTime(),
                    stop: stopDate.getTime(),
                    title: prog.title ? prog.title[0]._ || prog.title[0] : 'Unknown',
                    desc: prog.desc ? prog.desc[0]._ || prog.desc[0] : ''
                });
            }

            for (const ch in epgData) {
                epgData[ch].sort((a, b) => a.start - b.start);
                let futureCount = 0;
                epgData[ch] = epgData[ch].filter(p => {
                    const startTime = p.start;
                    if (startTime > nowTime) {
                        if (futureCount >= 5) return false;
                        futureCount++;
                    }
                    return true;
                });
            }
        }
        if (log) {
            log.debug('EPG parsed', {
                channels: Object.keys(epgData).length,
                programmes: Object.values(epgData).reduce((a, b) => a + b.length, 0),
                ms: Date.now() - start
            });
        }
        return epgData;
    } catch (e: any) {
        if (log) log.warn('EPG parse failed', e.message);
        return {};
    }
}

/**
 * Parse EPG time string (XMLTV format: YYYYMMDDHHmmss +HHMM).
 */
export function parseEPGTime(s: string, epgOffsetHours = 0) {
    if (!s) return new Date();
    const m = s.match(/^(\d{14})(?:\s*([+\-]\d{4}))?/);
    if (m) {
        const base = m[1];
        const tz = m[2] || null;
        const year = parseInt(base.slice(0, 4), 10);
        const month = parseInt(base.slice(4, 6), 10) - 1;
        const day = parseInt(base.slice(6, 8), 10);
        const hour = parseInt(base.slice(8, 10), 10);
        const min = parseInt(base.slice(10, 12), 10);
        const sec = parseInt(base.slice(12, 14), 10);
        let date: Date | undefined;
        if (tz) {
            const iso = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}${tz}`;
            const parsed = new Date(iso);
            if (!isNaN(parsed.getTime())) date = parsed;
        }
        if (!date) date = new Date(year, month, day, hour, min, sec);
        if (epgOffsetHours) {
            date = new Date(date.getTime() + epgOffsetHours * 3600000);
        }
        return date;
    }
    const d = new Date(s);
    if (epgOffsetHours && !isNaN(d.getTime()))
        return new Date(d.getTime() + epgOffsetHours * 3600000);
    return d;
}

/**
 * Find the currently airing program for a channel.
 */
export function getCurrentProgram(epgData: Record<string, any[]>, channelId: string, epgOffsetHours = 0) {
    if (!channelId || !epgData[channelId]) return null;
    const nowTime = Date.now();
    for (const p of epgData[channelId]) {
        const start = p.start + (epgOffsetHours * 3600000);
        const stop = p.stop + (epgOffsetHours * 3600000);
        if (nowTime >= start && nowTime <= stop) {
            const startDate = new Date(start);
            const stopDate = new Date(stop);
            return { title: p.title, description: p.desc, start: startDate, stop: stopDate, startTime: startDate, stopTime: stopDate };
        }
    }
    return null;
}

/**
 * Get upcoming programs for a channel.
 */
export function getUpcomingPrograms(epgData: Record<string, any[]>, channelId: string, limit = 5, epgOffsetHours = 0) {
    if (!channelId || !epgData[channelId]) return [];
    const nowTime = Date.now();
    const upcoming: any[] = [];
    for (const p of epgData[channelId]) {
        const start = p.start + (epgOffsetHours * 3600000);
        if (start > nowTime && upcoming.length < limit) {
            upcoming.push({
                title: p.title,
                description: p.desc,
                startTime: new Date(start),
                stopTime: new Date(p.stop + (epgOffsetHours * 3600000))
            });
        }
    }
    return upcoming.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}
