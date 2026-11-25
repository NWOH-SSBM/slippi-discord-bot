function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export const config = Object.freeze({
  discordToken: requiredEnvironmentVariable('DISCORD_TOKEN'),
  discordClientId: requiredEnvironmentVariable('DISCORD_CLIENT_ID'),
  discordGuildId: requiredEnvironmentVariable('DISCORD_GUILD_ID'),
  databasePath: process.env.DATABASE_PATH?.trim() || './data/slippi-discord-bot.sqlite',
});
