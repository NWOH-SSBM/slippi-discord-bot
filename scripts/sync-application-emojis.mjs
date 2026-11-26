import { once } from 'node:events';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { Client, Events } from 'discord.js';

const token = process.env.DISCORD_TOKEN?.trim();
const expectedApplicationId = process.env.DISCORD_CLIENT_ID?.trim();
const emojiDirectory = path.resolve('assets/ranks/png');

if (!token || !expectedApplicationId) {
  throw new Error('DISCORD_TOKEN and DISCORD_CLIENT_ID must be set in the environment.');
}

const files = (await readdir(emojiDirectory))
  .filter((file) => file.endsWith('.png'))
  .sort((left, right) => left.localeCompare(right));

if (files.length === 0) {
  throw new Error('No rank PNGs found. Run `npm run assets:import` first.');
}

const client = new Client({ intents: [] });

try {
  const ready = once(client, Events.ClientReady);
  await client.login(token);
  await ready;

  const application = client.application;

  if (!application || application.id !== expectedApplicationId) {
    throw new Error(
      `The token belongs to application ${application?.id ?? '(unknown)'}, ` +
        `not DISCORD_CLIENT_ID ${expectedApplicationId}.`,
    );
  }

  const existing = await application.emojis.fetch();
  const existingNames = new Set(existing.map((emoji) => emoji.name));
  let created = 0;
  let skipped = 0;

  for (const file of files) {
    const name = path.parse(file).name;

    if (existingNames.has(name)) {
      console.info(`Skipping existing application emoji :${name}:.`);
      skipped += 1;
      continue;
    }

    const filePath = path.join(emojiDirectory, file);
    const emoji = await application.emojis.create({ attachment: filePath, name });
    existingNames.add(emoji.name);
    console.info(`Created application emoji :${emoji.name}: (${emoji.id}).`);
    created += 1;
  }

  console.info(`Application emoji sync complete: ${created} created, ${skipped} already present.`);
} finally {
  client.destroy();
}
