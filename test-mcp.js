const http = require('http');

function sendPost(endpoint, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(endpoint);
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c.toString());
      res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const sseReq = http.get('http://localhost:7071/runtime/webhooks/mcp/sse', (res) => {
  console.log('SSE status:', res.statusCode);
  console.log('SSE headers:', JSON.stringify(res.headers));
  let buf = '';
  let endpointFound = false;

  res.on('data', async (chunk) => {
    const text = chunk.toString();
    console.log('SSE chunk:', JSON.stringify(text));
    buf += text;

    if (!endpointFound) {
      const match = buf.match(/data: ([^\n\r]+)/);
      if (match) {
        endpointFound = true;
        let endpoint = match[1].trim();
        // Handle relative URLs
        if (!endpoint.startsWith('http')) {
          endpoint = 'http://localhost:7071/runtime/webhooks/mcp/' + endpoint;
        }
        console.log('Session endpoint:', endpoint);

        try {
          // Initialize
          await sendPost(endpoint, {
            jsonrpc: '2.0', id: 1, method: 'initialize',
            params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
          });
          console.log('Initialized');

          // Initialized notification
          await sendPost(endpoint, { jsonrpc: '2.0', method: 'initialized' });

          // Call GetWeather
          await sendPost(endpoint, {
            jsonrpc: '2.0', id: 2, method: 'tools/call',
            params: { name: 'GetWeather', arguments: { location: '94568' } }
          });
          console.log('Tool call sent, waiting for response...');
        } catch (e) {
          console.error('Error:', e.message);
          process.exit(1);
        }
      }
    }

    // Check for tool result in SSE stream
    const lines = buf.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ') && line.includes('"id":2')) {
        try {
          const obj = JSON.parse(line.slice(6));
          console.log('\nWeather Result:');
          if (obj.result && obj.result.content) {
            for (const c of obj.result.content) {
              console.log(c.text || JSON.stringify(c, null, 2));
            }
          } else {
            console.log(JSON.stringify(obj, null, 2));
          }
          sseReq.destroy();
          process.exit(0);
        } catch (e) { }
      }
    }
  });
});

sseReq.on('error', (e) => { console.error('SSE error:', e.message); process.exit(1); });
setTimeout(() => { console.log('\nTimeout - no response received'); sseReq.destroy(); process.exit(1); }, 20000);
