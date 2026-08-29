import { supabase } from './supabaseClient';

export interface Rater {
  id: string;
  name: string;
  isAdmin: boolean;
}

export interface Game {
  id: string;
  title: string;
  bannerUrl: string;
  createdAt: string;
  ratings: Record<string, number | null>;
}

export interface Board {
  raters: Rater[];
  games: Game[];
}

export interface PlayerSession {
  id: string;
  name: string;
  isAdmin: boolean;
  isGuest: boolean;
  sessionToken: string;
}

interface UnlockPayload {
  id: string;
  name: string;
  is_admin: boolean;
  is_guest?: boolean;
  session_token: string;
}

function requireClient() {
  if (!supabase) {
    throw new Error('Supabase is not configured');
  }

  return supabase;
}

export function isSupabaseConfigured(): boolean {
  return supabase !== null;
}

function parseStoredScore(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.round(numeric * 10) / 10;
}

function mapSession(data: unknown): PlayerSession | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const row = data as UnlockPayload;
  if (typeof row.id !== 'string' || typeof row.session_token !== 'string') {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    isAdmin: Boolean(row.is_admin),
    isGuest: Boolean(row.is_guest),
    sessionToken: row.session_token,
  };
}

export async function loadBoard(): Promise<Board> {
  const client = requireClient();
  const [playersRes, gamesRes, ratingsRes] = await Promise.all([
    client
      .from('players')
      .select('id, name, is_admin, sort_order')
      .order('sort_order'),
    client.from('games').select('id, title, banner_url, created_at').order('created_at'),
    client.from('ratings').select('game_id, player_id, score'),
  ]);

  if (playersRes.error) {
    throw playersRes.error;
  }

  if (gamesRes.error) {
    throw gamesRes.error;
  }

  if (ratingsRes.error) {
    throw ratingsRes.error;
  }

  const raters: Rater[] = (playersRes.data ?? []).flatMap((row) => {
    if (row.id === 'guest') {
      return [];
    }

    return [
      {
        id: row.id,
        name: row.name,
        isAdmin: Boolean(row.is_admin),
      },
    ];
  });

  const ratingsByGame: Record<string, Record<string, number>> = {};
  (ratingsRes.data ?? []).forEach((row) => {
    const score = parseStoredScore(row.score);
    if (score === null) {
      return;
    }

    if (!ratingsByGame[row.game_id]) {
      ratingsByGame[row.game_id] = {};
    }

    ratingsByGame[row.game_id][row.player_id] = score;
  });

  const games: Game[] = (gamesRes.data ?? []).map((row) => {
    const ratings: Record<string, number | null> = {};
    raters.forEach((rater) => {
      ratings[rater.id] = ratingsByGame[row.id]?.[rater.id] ?? null;
    });

    return {
      id: row.id,
      title: row.title ?? '',
      bannerUrl: row.banner_url ?? '',
      createdAt: typeof row.created_at === 'string' ? row.created_at : '',
      ratings,
    };
  });

  return { raters, games };
}

export async function unlockWithPin(
  pin: string,
): Promise<PlayerSession | null> {
  const { data, error } = await requireClient().rpc('unlock_with_pin', {
    p_pin: pin,
  });

  if (error) {
    throw error;
  }

  return mapSession(data);
}

export async function restoreSession(
  token: string,
): Promise<PlayerSession | null> {
  const { data, error } = await requireClient().rpc('get_session', {
    p_token: token,
  });

  if (error) {
    throw error;
  }

  return mapSession(data);
}

export async function addGame(
  token: string,
): Promise<{ id: string; title: string }> {
  const { data, error } = await requireClient().rpc('add_game', {
    p_token: token,
  });

  if (error) {
    throw error;
  }

  const row = data as { id: string; title: string } | null;
  if (!row?.id) {
    throw new Error('Could not add game');
  }

  return row;
}

export async function updateGame(
  token: string,
  gameId: string,
  title: string,
  bannerUrl?: string,
): Promise<void> {
  const payload: {
    p_token: string;
    p_game_id: string;
    p_title: string;
    p_banner_url?: string;
  } = {
    p_token: token,
    p_game_id: gameId,
    p_title: title,
  };

  if (bannerUrl !== undefined) {
    payload.p_banner_url = bannerUrl;
  }

  const { error } = await requireClient().rpc('update_game', payload);

  if (error) {
    throw error;
  }
}

export async function setRating(
  token: string,
  gameId: string,
  score: number | null,
): Promise<void> {
  const { error } = await requireClient().rpc('set_rating', {
    p_token: token,
    p_game_id: gameId,
    p_score: score,
  });

  if (error) {
    throw error;
  }
}

export async function updatePlayer(
  token: string,
  playerId: string,
  name: string,
  pin?: string,
): Promise<{ id: string; name: string }> {
  const { data, error } = await requireClient().rpc('update_player', {
    p_token: token,
    p_player_id: playerId,
    p_name: name,
    p_pin: pin ?? '',
  });

  if (error) {
    throw error;
  }

  const row = data as { id: string; name: string } | null;
  if (!row?.id) {
    throw new Error('Could not update player');
  }

  return row;
}

export async function deletePlayer(
  token: string,
  playerId: string,
): Promise<void> {
  const { error } = await requireClient().rpc('delete_player', {
    p_token: token,
    p_player_id: playerId,
  });

  if (error) {
    throw error;
  }
}

export async function addPlayer(
  token: string,
  name: string,
  pin: string,
): Promise<{ id: string; name: string }> {
  const { data, error } = await requireClient().rpc('add_player', {
    p_token: token,
    p_name: name,
    p_pin: pin,
  });

  if (error) {
    throw error;
  }

  const row = data as { id: string; name: string } | null;
  if (!row?.id) {
    throw new Error('Could not add player');
  }

  return row;
}

export async function deleteGame(token: string, gameId: string): Promise<void> {
  const { error } = await requireClient().rpc('delete_game', {
    p_token: token,
    p_game_id: gameId,
  });

  if (error) {
    throw error;
  }
}

export async function importBoard(
  token: string,
  games: { title: string; ratings: Record<string, number | null> }[],
): Promise<void> {
  const { error } = await requireClient().rpc('import_board', {
    p_token: token,
    p_games: games,
  });

  if (error) {
    throw error;
  }
}

export function subscribeToBoard(onChange: () => void): () => void {
  const client = requireClient();
  const channel = client
    .channel('game-ratings-board')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'games' },
      onChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'ratings' },
      onChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'players' },
      onChange,
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}
