function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function initSse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
}

module.exports = {
  sse,
  initSse
};