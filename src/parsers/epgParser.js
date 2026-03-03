const xml2js = require('xml2js');
const { makeLogger } = require('../utils/logger');

/**
 * Parse XMLTV EPG content into a channel-keyed object.
 * @param {string} content - Raw XML string
 * @param {object} [log] - Logger instance
 * @returns {Promise<Object>} { channelId: [{ start, stop, title, desc }] }
 */
async function parseEPG(content, log) {
    const start = Date.now();
    try {
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(content);
        const epgData = {};
        if (result.tv && result.tv.programme) {
            const cutoff = Date.now() - 3600 * 1000; // 1 hour ago
            const nowTime = Date.now();
            for (const prog of result.tv.programme) {
                const stopDate = parseEPGTime(prog.$.stop);
                if (stopDate.getTime() < cutoff) continue;

                const ch = prog.$.channel;
                if (!epgData[ch]) epgData[ch] = [];
                epgData[ch].push({
                    start: prog.$.start,
                    stop: prog.$.stop,
                    title: prog.title ? prog.title[0]._ || prog.title[0] : 'Unknown',
                    desc: prog.desc ? prog.desc[0]._ || prog.desc[0] : ''
                });
            }

            for (const ch in epgData) {
                epgData[ch].sort((a, b) => parseEPGTime(a.start).getTime() - parseEPGTime(b.start).getTime());
                let futureCount = 0;
                epgData[ch] = epgData[ch].filter(p => {
                    const startTime = parseEPGTime(p.start).getTime();
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
    } catch (e) {
        if (log) log.warn('EPG parse failed', e.message);
        return {};
    }
}

/**
 * Parse EPG time string (XMLTV format: YYYYMMDDHHmmss +HHMM).
 * @param {string} s - EPG time string
 * @param {number} [epgOffsetHours=0] - Hours to offset
 * @returns {Date}
 */
function parseEPGTime(s, epgOffsetHours = 0) {
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
        let date;
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
 * @param {Object} epgData - Full EPG data object
 * @param {string} channelId - Channel EPG ID
 * @param {number} [epgOffsetHours=0]
 * @returns {Object|null}
 */
function getCurrentProgram(epgData, channelId, epgOffsetHours = 0) {
    if (!channelId || !epgData[channelId]) return null;
    const now = new Date();
    for (const p of epgData[channelId]) {
        const start = parseEPGTime(p.start, epgOffsetHours);
        const stop = parseEPGTime(p.stop, epgOffsetHours);
        if (now >= start && now <= stop) {
            return { title: p.title, description: p.desc, start, stop, startTime: start, stopTime: stop };
        }
    }
    return null;
}

/**
 * Get upcoming programs for a channel.
 * @param {Object} epgData - Full EPG data object
 * @param {string} channelId
 * @param {number} [limit=5]
 * @param {number} [epgOffsetHours=0]
 * @returns {Array}
 */
function getUpcomingPrograms(epgData, channelId, limit = 5, epgOffsetHours = 0) {
    if (!channelId || !epgData[channelId]) return [];
    const now = new Date();
    const upcoming = [];
    for (const p of epgData[channelId]) {
        const start = parseEPGTime(p.start, epgOffsetHours);
        if (start > now && upcoming.length < limit) {
            upcoming.push({
                title: p.title,
                description: p.desc,
                startTime: start,
                stopTime: parseEPGTime(p.stop, epgOffsetHours)
            });
        }
    }
    return upcoming.sort((a, b) => a.startTime - b.startTime);
}

module.exports = { parseEPG, parseEPGTime, getCurrentProgram, getUpcomingPrograms };
