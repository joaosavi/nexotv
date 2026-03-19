export const SAMPLE_M3U = `#EXTM3U x-tvg-url="http://epg.example.com/guide.xml"
#EXTINF:-1 tvg-id="cnn.us" tvg-name="CNN" tvg-logo="http://logo.example.com/cnn.png" group-title="News",CNN
http://stream.example.com/cnn
#EXTINF:-1 tvg-id="espn.us" tvg-name="ESPN" group-title="Sports" user-agent="VLC/3.0",ESPN
http://stream.example.com/espn
#EXTINF:-1 tvg-id="hbo.us" tvg-name="HBO" group-title="Movies",HBO
http://stream.example.com/hbo
`;

export const MALFORMED_M3U = `#EXTM3U
#EXTINF:-1,No URL channel
#EXTINF:-1 tvg-id="noid",Missing stream URL
http://valid.example.com/stream
`;

export const SAMPLE_XMLTV = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="cnn.us"><display-name>CNN</display-name></channel>
  <programme start="20260319120000 +0000" stop="20260319130000 +0000" channel="cnn.us">
    <title>CNN Newsroom</title>
    <desc>Live news coverage</desc>
  </programme>
  <programme start="20260319130000 +0000" stop="20260319140000 +0000" channel="cnn.us">
    <title>The Situation Room</title>
  </programme>
</tv>`;

/** Gera playlist M3U com N canais para benchmarks */
export function generateLargeM3U(channelCount: number): string {
  const lines = ['#EXTM3U'];
  for (let i = 0; i < channelCount; i++) {
    lines.push(
      `#EXTINF:-1 tvg-id="ch${i}.test" tvg-name="Channel ${i}" group-title="Group${i % 50}",Channel ${i}`,
      `http://stream.example.com/ch${i}`
    );
  }
  return lines.join('\n');
}

/** Gera XMLTV com N programas por canal */
export function generateLargeXMLTV(channels: number, programsPerChannel: number): string {
  const now = new Date('2026-03-19T12:00:00Z');
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n';

  for (let c = 0; c < channels; c++) {
    xml += `  <channel id="ch${c}.test"><display-name>Channel ${c}</display-name></channel>\n`;
  }
  for (let c = 0; c < channels; c++) {
    for (let p = 0; p < programsPerChannel; p++) {
      const start = new Date(now.getTime() + p * 3600000);
      const stop = new Date(start.getTime() + 3600000);
      const fmt = (d: Date) =>
        d.toISOString().replace(/[-T:]/g, '').slice(0, 14) + ' +0000';
      xml += `  <programme start="${fmt(start)}" stop="${fmt(stop)}" channel="ch${c}.test">`;
      xml += `<title>Show ${p}</title></programme>\n`;
    }
  }
  xml += '</tv>';
  return xml;
}
