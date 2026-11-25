import { REST, Routes } from 'discord.js';
import { commandDefinitions } from './commands/definitions.js';
import { config } from './config.js';

const rest = new REST({ version: '10' }).setToken(config.discordToken);
const route = Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId);

await rest.put(route, {
  body: commandDefinitions.map((command) => command.toJSON()),
});

console.info(`Registered ${commandDefinitions.length} guild commands.`);
