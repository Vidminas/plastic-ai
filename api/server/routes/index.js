const { createUnsupportedRouter } = require('@librechat/api');
const unsupported = (feature) => createUnsupportedRouter(feature);

// const accessPermissions = require('./accessPermissions');
const accessPermissions = unsupported('permissions');
// const assistants = require('./assistants');
const assistants = unsupported('assistants');
// const categories = require('./categories');
const categories = unsupported('categories');
// const adminAuth = require('./admin/auth');
const adminAuth = unsupported('administration');
// const adminConfig = require('./admin/config');
const adminConfig = unsupported('administration');
// const adminCodeEnvironments = require('./admin/code');
const adminCodeEnvironments = unsupported('code-environments');
// const codeEnvironments = require('./code-environments');
const codeEnvironments = unsupported('code-environments');
// const adminLangfuse = require('./admin/langfuse');
const adminLangfuse = unsupported('administration');
// const adminGrants = require('./admin/grants');
const adminGrants = unsupported('administration');
// const adminGroups = require('./admin/groups');
const adminGroups = unsupported('administration');
// const adminRoles = require('./admin/roles');
const adminRoles = unsupported('administration');
// const adminSkills = require('./admin/skills');
const adminSkills = unsupported('skills');
// const adminUsers = require('./admin/users');
const adminUsers = unsupported('administration');
// const adminAuditLog = require('./admin/audit');
const adminAuditLog = unsupported('audit-log');
const endpoints = require('./endpoints');
const staticRoute = require('./static');
const messages = require('./messages');
// const memories = require('./memories');
const memories = unsupported('memory');
// const presets = require('./presets');
const presets = unsupported('presets');
// const projects = require('./projects');
const projects = unsupported('projects');
// const prompts = require('./prompts');
const prompts = unsupported('prompts');
// const schedules = require('./schedules');
const schedules = unsupported('schedules');
// const skills = require('./skills');
const skills = unsupported('skills');
// const balance = require('./balance');
const balance = unsupported('balances');
// const actions = require('./actions');
const actions = unsupported('actions');
// const apiKeys = require('./apiKeys');
const apiKeys = unsupported('api-keys');
// const banner = require('./banner');
const banner = unsupported('banner');
// const search = require('./search');
const search = unsupported('search');
const models = require('./models');
const convos = require('./convos');
// const traces = require('./traces');
const traces = unsupported('traces');
const config = require('./config');
const agents = require('./agents');
const roles = require('./roles');
// const oauth = require('./oauth');
const oauth = unsupported('oauth');
const files = require('./files');
// const filesRouter = unsupported('files');
// const files = { initialize: async () => filesRouter };
// const share = require('./share');
const share = unsupported('shared-links');
// const tags = require('./tags');
const tags = unsupported('conversation-tags');
const auth = require('./auth');
// const keys = require('./keys');
const keys = unsupported('user-keys');
const user = require('./user');
// const mcp = require('./mcp');
const mcp = unsupported('mcp');
// const rum = require('./rum');
const rum = unsupported('rum');
// const insights = require('./insights');
const insights = unsupported('insights');

module.exports = {
  insights,
  rum,
  mcp,
  auth,
  adminAuth,
  adminConfig,
  adminCodeEnvironments,
  codeEnvironments,
  adminLangfuse,
  adminGrants,
  adminGroups,
  adminRoles,
  adminSkills,
  adminUsers,
  adminAuditLog,
  keys,
  apiKeys,
  user,
  tags,
  roles,
  oauth,
  files,
  share,
  banner,
  agents,
  convos,
  traces,
  search,
  config,
  models,
  prompts,
  projects,
  schedules,
  skills,
  actions,
  presets,
  balance,
  messages,
  memories,
  endpoints,
  assistants,
  categories,
  staticRoute,
  accessPermissions,
};
