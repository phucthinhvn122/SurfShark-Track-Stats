const { fork } = require('child_process');
const path = require('path');

console.log('Starting combined API and Telegram Worker...');

const apiPath = path.resolve(__dirname, '../apps/api/dist/main.js');
const workerPath = path.resolve(__dirname, '../apps/telegram-worker/dist/worker.js');

const apiProcess = fork(apiPath, [], {
  env: { ...process.env }
});

const workerProcess = fork(workerPath, [], {
  env: { ...process.env }
});

const handleExit = (code, signal, serviceName) => {
  console.log(`${serviceName} exited with code ${code} and signal ${signal}`);
  // Exit the main process to allow the platform (Render) to restart the container
  process.exit(code || 1);
};

apiProcess.on('exit', (code, signal) => handleExit(code, signal, 'API'));
workerProcess.on('exit', (code, signal) => handleExit(code, signal, 'Worker'));

const cleanup = (signal) => {
  console.log(`${signal} received. Cleaning up processes...`);
  apiProcess.kill(signal);
  workerProcess.kill(signal);
};

process.on('SIGTERM', () => cleanup('SIGTERM'));
process.on('SIGINT', () => cleanup('SIGINT'));
