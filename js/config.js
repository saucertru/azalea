// =====================================================================
// Azelela settings - edit these, then redeploy.
// =====================================================================
export const CONFIG = {
  siteName: 'Azelela',

  // Supabase -> Project Settings -> API. The anon key is safe to put here
  // (Row Level Security in supabase/schema.sql protects the data).
  supabaseUrl: '',
  supabaseAnonKey: '',

  // Optional. A free YouTube Data API v3 key turns on YouTube search in
  // Music. Without it you can still paste YouTube links.
  youtubeApiKey: '',

  // Live TV: official live streams that broadcasters publish themselves on
  // YouTube. Add/remove channels by YouTube channel ID (starts with UC...).
  // A channel only plays while it is live.
  liveChannels: [
    { name: 'DW News', channel: 'UCknLrEdhRCp1aegoMqRaCZg' },
    { name: 'France 24 English', channel: 'UCQfwfsi5VrQ8yKZ-UWmAEFg' },
    { name: 'Al Jazeera English', channel: 'UCNye-wNBqNL5ZzHSJj3l8Bg' },
    { name: 'ABC News Australia', channel: 'UCVgO39Bk5sMo66-6o6Spn6Q' },
    { name: 'Sky News', channel: 'UCoMdktPbSTixAyNGwb-UYkQ' },
    { name: 'NASA', channel: 'UCLA_DiR1FfKNvjuUpBHmylQ' },
  ],

  // Public-domain TV and films from the Internet Archive
  archiveCollections: [
    { id: 'classic_tv', name: 'Classic TV' },
    { id: 'feature_films', name: 'Public domain films' },
    { id: 'classic_cartoons', name: 'Classic cartoons' },
  ],
};
