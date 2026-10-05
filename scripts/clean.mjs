import { rm } from 'node:fs/promises';

await Promise.all(['dist', 'server.js'].map((path) => rm(new URL(`../${path}`, import.meta.url), {
  recursive: true,
  force: true,
})));
