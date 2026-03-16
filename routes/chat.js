const express = require('express');
const { initSse } = require('../lib/sse');
const { handleChat } = require('../services/chatService');

const router = express.Router();

router.post('/chat', async (req, res) => {
  initSse(res);
  await handleChat(req, res);
});

module.exports = router;