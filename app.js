require('dotenv').config();

const express = require('express');
const cors = require('cors');

const { startPromptRefresh } = require('./services/promptService');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const siteRoutes = require('./routes/site');
const examplePromptRoutes = require('./routes/examplePrompts');
const chatRoutes = require('./routes/chat');
const adminSettingsRoutes = require('./routes/adminSettings');
const adminDataRoutes = require('./routes/adminData');
const adminUsersRoutes = require('./routes/adminUsers');

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static('public'));

startPromptRefresh();

const api = express.Router();

api.use(healthRoutes);
api.use(authRoutes);
api.use(siteRoutes);
api.use(examplePromptRoutes);
api.use(chatRoutes);
api.use(adminSettingsRoutes);
api.use(adminDataRoutes);
api.use(adminUsersRoutes);

app.use('/api', api);
app.use('/', api);

module.exports = app;