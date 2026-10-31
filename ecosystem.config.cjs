module.exports = {
  apps: [{
    name: 'story-make',
    script: './scripts/start-production.sh',
    interpreter: '/bin/bash',
    cwd: process.env.STORY_DEPLOY_ROOT ? `${process.env.STORY_DEPLOY_ROOT}/current` : '/srv/story-make/current',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
  }],
};
