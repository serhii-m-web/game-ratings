import {
  addGame as addGameRemote,
  addPlayer as addPlayerRemote,
  deletePlayer as deletePlayerRemote,
  updatePlayer as updatePlayerRemote,
  deleteGame as deleteGameRemote,
  importBoard,
  isSupabaseConfigured,
  loadBoard,
  restoreSession,
  setRating,
  subscribeToBoard,
  unlockWithPin,
  updateGame,
  type Board,
  type Game,
  type PlayerSession,
  type Rater,
} from './boardApi';
import {
  searchGames,
  type GameSuggestion,
} from './gameSearch';

const LEGACY_STORAGE_KEY = 'game-ratings:v1';
const SESSION_KEY = 'game-ratings:session';
const MIN_SCORE = 0;
const MAX_SCORE = 10;

function sanitizeScoreInput(raw: string): string {
  let integer = '';
  let fraction = '';
  let seenDot = false;

  for (const char of raw.replace(/,/g, '.')) {
    if (char >= '0' && char <= '9') {
      if (seenDot) {
        if (fraction.length === 0) {
          fraction = char;
        }
      } else if (!integer) {
        integer = char;
      } else if (integer === '1' && char === '0') {
        integer = '10';
      } else if (integer.length === 1) {
        seenDot = true;
        fraction = char;
      }
    } else if (char === '.' && !seenDot) {
      seenDot = true;
    }
  }

  if (seenDot) {
    return `${integer}.${fraction}`;
  }

  return integer;
}

function parseScore(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  let numeric = value;
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(',', '.');
    if (!trimmed) {
      return null;
    }
    numeric = Number(trimmed);
  }

  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
    return null;
  }

  const clamped = Math.min(MAX_SCORE, Math.max(MIN_SCORE, numeric));
  return Math.round(clamped * 10) / 10;
}

function formatScore(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, '');
}

function formatScoreLabel(value: number): string {
  return `${formatScore(value)}/10`;
}

function scoreClass(score: number | null): string {
  if (score === null) {
    return 'ratings__score';
  }

  if (score >= 8) {
    return 'ratings__score is-high';
  }

  if (score <= 4) {
    return 'ratings__score is-low';
  }

  return 'ratings__score';
}

function scoreValueClass(score: number): string {
  if (score >= 8) {
    return 'ratings__score-value is-high';
  }

  if (score <= 4) {
    return 'ratings__score-value is-low';
  }

  return 'ratings__score-value';
}

function loadSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function saveSessionToken(token: string): void {
  localStorage.setItem(SESSION_KEY, token);
}

function clearSessionToken(): void {
  localStorage.removeItem(SESSION_KEY);
}

function loadLegacyBoard(): {
  title: string;
  ratings: Record<string, number | null>;
}[] {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as { games?: unknown };
    if (!Array.isArray(parsed.games)) {
      return [];
    }

    return parsed.games.flatMap((item) => {
      if (!item || typeof item !== 'object') {
        return [];
      }

      const game = item as { title?: unknown; ratings?: unknown };
      const ratings: Record<string, number | null> = {};

      if (game.ratings && typeof game.ratings === 'object') {
        Object.entries(game.ratings as Record<string, unknown>).forEach(
          ([playerId, score]) => {
            ratings[playerId] = parseScore(score);
          },
        );
      }

      return [
        {
          title: typeof game.title === 'string' ? game.title : '',
          ratings,
        },
      ];
    });
  } catch {
    return [];
  }
}

function clearLegacyBoard(): void {
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: {
    className?: string;
    text?: string;
    attrs?: Record<string, string>;
  } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (options.className) {
    node.className = options.className;
  }

  if (options.text) {
    node.textContent = options.text;
  }

  if (options.attrs) {
    Object.entries(options.attrs).forEach(([name, value]) => {
      node.setAttribute(name, value);
    });
  }

  return node;
}

function createTitleText(game: Game): HTMLParagraphElement {
  return el('p', {
    className: 'ratings__title-text',
    text: game.title,
    attrs: {
      'data-game': game.id,
    },
  });
}

function formatAddedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function createAddedDate(game: Game): HTMLTimeElement | null {
  const label = formatAddedDate(game.createdAt);
  if (!label) {
    return null;
  }

  return el('time', {
    className: 'ratings__added',
    text: label,
    attrs: {
      datetime: game.createdAt,
    },
  });
}

function createScoreInput(
  game: Game,
  rater: Rater,
  score: number | null,
): HTMLInputElement {
  const attrs: Record<string, string> = {
    type: 'text',
    inputmode: 'decimal',
    pattern: '[0-9]*[.,]?[0-9]?',
    placeholder: '—',
    'data-field': 'score',
    'data-game': game.id,
    'data-rater': rater.id,
    'aria-label': `${game.title || 'Game'} — rating by ${rater.name}`,
    autocomplete: 'off',
  };

  if (score !== null) {
    attrs.value = formatScore(score);
  }

  return el('input', {
    className: scoreClass(score),
    attrs,
  });
}

function createScoreValue(
  game: Game,
  rater: Rater,
  score: number,
): HTMLButtonElement {
  return el('button', {
    className: scoreValueClass(score),
    text: formatScoreLabel(score),
    attrs: {
      type: 'button',
      'data-action': 'edit-score',
      'data-game': game.id,
      'data-rater': rater.id,
      'aria-label': `${game.title || 'Game'} — ${formatScoreLabel(
        score,
      )}. Click to edit.`,
    },
  });
}

function createScoreLocked(
  game: Game,
  rater: Rater,
  score: number | null,
): HTMLSpanElement {
  if (score === null) {
    return el('span', {
      className: 'ratings__score-value is-locked is-empty',
      text: '—',
      attrs: {
        'aria-label': `${game.title || 'Game'} — ${rater.name}: no rating`,
      },
    });
  }

  return el('span', {
    className: `${scoreValueClass(score)} is-locked`,
    text: formatScoreLabel(score),
    attrs: {
      'aria-label': `${game.title || 'Game'} — ${
        rater.name
      }: ${formatScoreLabel(score)}`,
    },
  });
}

export function initRatings(): void {
  const table = document.querySelector<HTMLTableElement>(
    '[data-ratings-table]',
  );
  const status = document.querySelector<HTMLElement>('[data-ratings-status]');
  const addGameButtons = document.querySelectorAll<HTMLButtonElement>(
    '[data-action="add-game"]',
  );
  const addPlayerButton = document.querySelector<HTMLButtonElement>(
    '[data-action="manage-players"]',
  );
  const addPlayerForm = document.querySelector<HTMLFormElement>(
    '[data-form="add-player"]',
  );
  const playerError = document.querySelector<HTMLElement>(
    '[data-player-error]',
  );
  const adminModal = document.querySelector<HTMLElement>('[data-admin-modal]');
  const adminPlayers = document.querySelector<HTMLElement>(
    '[data-admin-players]',
  );
  const shareButton = document.querySelector<HTMLButtonElement>(
    '[data-action="share"]',
  );
  const switchButton = document.querySelector<HTMLButtonElement>(
    '[data-action="switch-player"]',
  );
  const pinGate = document.querySelector<HTMLElement>('[data-pin-gate]');
  const pinForm = document.querySelector<HTMLFormElement>('[data-form="pin"]');
  const pinError = document.querySelector<HTMLElement>('[data-pin-error]');
  const boardView = document.querySelector<HTMLElement>('[data-ratings-board]');
  const playerLabel = document.querySelector<HTMLElement>(
    '[data-player-label]',
  );
  const listSearch = document.querySelector<HTMLInputElement>(
    '[data-list-search]',
  );
  const sortButtons = document.querySelectorAll<HTMLButtonElement>(
    '[data-sort]',
  );

  if (
    !table ||
    addGameButtons.length === 0 ||
    !addPlayerButton ||
    !addPlayerForm ||
    !adminModal ||
    !adminPlayers ||
    !shareButton ||
    !switchButton ||
    !pinGate ||
    !pinForm ||
    !boardView ||
    !listSearch ||
    sortButtons.length === 0
  ) {
    return;
  }

  const boardTable = table;
  const accessGate = pinGate;
  const accessForm = pinForm;
  const accessBoard = boardView;
  const playerForm = addPlayerForm;
  const playerButton = addPlayerButton;
  const playersModal = adminModal;
  const playersList = adminPlayers;
  const tableScroll = boardTable.closest('.ratings__table-scroll');
  const suggestRoot = el('ul', {
    className: 'ratings__suggest',
    attrs: {
      hidden: '',
      role: 'listbox',
    },
  });
  const notice = el('p', {
    className: 'ratings__notice',
    attrs: {
      role: 'status',
      'aria-live': 'polite',
    },
  });
  document.body.append(suggestRoot, notice);
  let noticeTimer = 0;

  let board: Board = { raters: [], games: [] };
  let session: PlayerSession | null = null;
  let listQuery = '';
  type ListSort = 'name' | 'date' | 'rating';
  let listSort: ListSort = 'name';
  let refreshing = false;
  let refreshQueued = false;
  let suggestGameId: string | null = null;
  let suggestItems: GameSuggestion[] = [];
  let suggestIndex = -1;
  let suggestTimer = 0;
  let suggestAbort: AbortController | null = null;
  let skipSuggest = false;
  let skipTitlePersist = false;

  function setStatus(message: string): void {
    if (status) {
      status.textContent = message;
    }
  }

  function notifyDuplicate(title?: string): void {
    const name = title?.trim() || 'This game';
    const message = `${name} is already on the list.`;

    setStatus(message);
    notice.textContent = message;
    notice.classList.add('is-visible');

    if (noticeTimer) {
      window.clearTimeout(noticeTimer);
    }

    noticeTimer = window.setTimeout(() => {
      notice.classList.remove('is-visible');
      noticeTimer = 0;
    }, 3600);
  }

  function findGame(gameId: string): Game | undefined {
    return board.games.find((game) => game.id === gameId);
  }

  function normalizeGameTitle(title: string): string {
    return title.trim().toLowerCase();
  }

  function isDuplicateTitle(title: string, gameId: string): boolean {
    const normalized = normalizeGameTitle(title);
    if (!normalized) {
      return false;
    }

    return board.games.some(
      (game) =>
        game.id !== gameId && normalizeGameTitle(game.title) === normalized,
    );
  }

  function compareByName(left: Game, right: Game): number {
    const a = left.title.trim();
    const b = right.title.trim();
    if (!a && !b) {
      return 0;
    }
    if (!a) {
      return -1;
    }
    if (!b) {
      return 1;
    }
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  }

  function compareByDate(left: Game, right: Game): number {
    const a = Date.parse(left.createdAt);
    const b = Date.parse(right.createdAt);
    const aOk = Number.isFinite(a);
    const bOk = Number.isFinite(b);
    if (!aOk && !bOk) {
      return compareByName(left, right);
    }
    if (!aOk) {
      return 1;
    }
    if (!bOk) {
      return -1;
    }
    return b - a || compareByName(left, right);
  }

  function averageRating(game: Game): number | null {
    const scores = Object.values(game.ratings).filter(
      (score): score is number => score !== null,
    );
    if (!scores.length) {
      return null;
    }

    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }

  function compareByRating(left: Game, right: Game): number {
    const a = averageRating(left);
    const b = averageRating(right);
    if (a === null && b === null) {
      return compareByName(left, right);
    }
    if (a === null) {
      return 1;
    }
    if (b === null) {
      return -1;
    }
    return b - a || compareByName(left, right);
  }

  function visibleGames(): Game[] {
    const query = listQuery.trim().toLowerCase();
    const games = query
      ? board.games.filter((game) => game.title.toLowerCase().includes(query))
      : board.games.slice();

    const compare =
      listSort === 'date'
        ? compareByDate
        : listSort === 'rating'
          ? compareByRating
          : compareByName;

    return games.sort(compare);
  }

  function syncSortButtons(): void {
    sortButtons.forEach((button) => {
      const active = button.dataset.sort === listSort;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function findRater(raterId: string): Rater | undefined {
    return board.raters.find((rater) => rater.id === raterId);
  }

  function canMutate(): boolean {
    return session !== null && !session.isGuest;
  }

  function canEditColumn(raterId: string): boolean {
    return canMutate() && session?.id === raterId;
  }

  function isAdmin(): boolean {
    return session?.isAdmin === true;
  }

  function isGuest(): boolean {
    return session?.isGuest === true;
  }

  function sessionStatus(next: PlayerSession): string {
    if (next.isGuest) {
      return 'Viewing as Guest. The table is read-only.';
    }

    return `Column unlocked: ${next.name}.`;
  }

  function setPlayerError(message: string): void {
    if (playerError) {
      playerError.textContent = message;
    }
  }

  function bindPinDigits(input: HTMLInputElement): void {
    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D/g, '').slice(0, 4);
      if (input.value !== digits) {
        input.value = digits;
      }
    });
  }

  function randomPin(): string {
    const digits = new Uint8Array(4);
    crypto.getRandomValues(digits);
    return Array.from(digits, (value) => String(value % 10)).join('');
  }

  function pinGenerateIcon(): string {
    return `<svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.6" y="1.6" width="12.8" height="12.8" rx="2.2" />
      <circle cx="5.2" cy="5.2" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="10.8" cy="5.2" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="5.2" cy="10.8" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="10.8" cy="10.8" r="1.05" fill="currentColor" stroke="none" />
    </svg>`;
  }

  function bindPinGenerate(
    input: HTMLInputElement,
    button: HTMLButtonElement,
  ): void {
    button.innerHTML = pinGenerateIcon();
    button.addEventListener('click', () => {
      const pin = randomPin();
      input.value = pin;
      input.type = 'text';
      input.focus();
      input.select();
      void navigator.clipboard.writeText(pin).then(
        () => {
          setStatus(`Generated PIN ${pin}. Copied.`);
        },
        () => {
          setStatus(`Generated PIN ${pin}.`);
        },
      );
    });
  }

  function createPinField(options: {
    placeholder: string;
    labelledBy: string;
    required?: boolean;
  }): HTMLDivElement {
    const field = el('div', {
      className: 'ratings__player-field ratings__player-field--pin',
    });
    const label = el('label');
    const attrs: Record<string, string> = {
      type: 'password',
      name: 'pin',
      inputmode: 'numeric',
      maxlength: '4',
      placeholder: options.placeholder,
      autocomplete: 'off',
    };

    if (options.required) {
      attrs.required = '';
      attrs.pattern = '[0-9]{4}';
    }

    const input = el('input', { attrs });
    const button = el('button', {
      className: 'ratings__icon-btn ratings__pin-generate',
      attrs: {
        type: 'button',
        'data-action': 'generate-pin',
        title: 'Generate PIN',
        'aria-label': 'Generate PIN',
      },
    });

    bindPinDigits(input);
    bindPinGenerate(input, button);
    label.append(
      el('span', {
        className: 'visually-hidden',
        text: options.labelledBy,
      }),
      input,
    );
    field.append(label, button);
    return field;
  }

  function closeAdminModal(): void {
    playersModal.hidden = true;
    playerForm.reset();
    const addPinInput = playerForm.querySelector<HTMLInputElement>(
      'input[name="pin"]',
    );
    if (addPinInput) {
      addPinInput.type = 'password';
    }
    setPlayerError('');
  }

  function openAdminModal(): void {
    if (!isAdmin()) {
      return;
    }

    setPlayerError('');
    renderAdminPlayers();
    playersModal.hidden = false;
  }

  function syncSessionControls(): void {
    const guest = isGuest();
    addGameButtons.forEach((button) => {
      button.hidden = guest;
    });
    accessBoard.classList.toggle('is-guest', guest);
    syncAdminControls();
  }

  function syncAdminControls(): void {
    const admin = isAdmin();
    playerButton.hidden = !admin;
    accessBoard.classList.toggle('is-admin', admin);
    if (!admin) {
      closeAdminModal();
    }
  }

  function renderAdminPlayers(): void {
    playersList.replaceChildren();

    board.raters.forEach((rater) => {
      const row = el('form', {
        className: 'ratings__admin-row',
        attrs: {
          'data-player-id': rater.id,
        },
      });

      if (rater.isAdmin) {
        row.append(
          el('p', {
            className: 'ratings__admin-badge',
            text: 'Admin',
          }),
        );
      }

      const nameField = el('label', { className: 'ratings__player-field' });
      nameField.append(
        el('span', {
          className: 'visually-hidden',
          text: `${rater.name} name`,
        }),
        el('input', {
          attrs: {
            type: 'text',
            name: 'name',
            value: rater.name,
            maxlength: '40',
            placeholder: 'Player name',
            autocomplete: 'off',
            required: '',
          },
        }),
      );

      const pinField = createPinField({
        placeholder: 'New PIN',
        labelledBy: `${rater.name} PIN`,
      });

      const saveButton = el('button', {
        className: 'ratings__btn ratings__btn--primary',
        text: 'Save',
        attrs: { type: 'submit' },
      });

      row.append(nameField, pinField, saveButton);

      if (!rater.isAdmin) {
        row.append(
          el('button', {
            className: 'ratings__btn ratings__btn--ghost',
            text: 'Delete',
            attrs: {
              type: 'button',
              'data-action': 'delete-player',
            },
          }),
        );
      }

      row.addEventListener('submit', (event) => {
        event.preventDefault();
        void saveAdminPlayer(rater.id, row);
      });

      row
        .querySelector<HTMLButtonElement>('[data-action="delete-player"]')
        ?.addEventListener('click', () => {
          void removeAdminPlayer(rater.id, rater.name);
        });

      playersList.append(row);
    });
  }

  async function saveAdminPlayer(
    playerId: string,
    row: HTMLFormElement,
  ): Promise<void> {
    if (!isAdmin() || !session) {
      return;
    }

    const data = new FormData(row);
    const name = String(data.get('name') ?? '').trim();
    const pin = String(data.get('pin') ?? '').replace(/\D/g, '');

    if (!name) {
      setPlayerError('Enter a player name.');
      return;
    }

    if (pin && pin.length !== 4) {
      setPlayerError('PIN must be 4 digits.');
      return;
    }

    try {
      const updated = await updatePlayerRemote(
        session.sessionToken,
        playerId,
        name,
        pin || undefined,
      );
      if (session.id === playerId) {
        session = { ...session, name: updated.name };
        if (playerLabel) {
          playerLabel.textContent = `Signed in as ${updated.name}`;
        }
      }
      board = await loadBoard();
      render();
      renderAdminPlayers();
      setPlayerError('');
      setStatus(`Updated ${updated.name}.`);
    } catch (error) {
      setPlayerError(playerErrorMessage(error));
    }
  }

  async function removeAdminPlayer(
    playerId: string,
    name: string,
  ): Promise<void> {
    if (!isAdmin() || !session) {
      return;
    }

    if (!window.confirm(`Delete player ${name}?`)) {
      return;
    }

    try {
      await deletePlayerRemote(session.sessionToken, playerId);
      board = await loadBoard();
      render();
      renderAdminPlayers();
      setPlayerError('');
      setStatus(`Deleted ${name}.`);
    } catch (error) {
      setPlayerError(playerErrorMessage(error));
    }
  }

  function playerErrorMessage(error: unknown): string {
    const raw =
      error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '';

    if (raw.includes('PIN already in use')) {
      return 'That PIN is already used.';
    }

    if (raw.includes('already exists')) {
      return 'A player with this name already exists.';
    }

    if (raw.includes('PIN must be 4 digits')) {
      return 'PIN must be 4 digits.';
    }

    if (raw.includes('Name is required')) {
      return 'Enter a player name.';
    }

    if (raw.includes('Cannot delete admin')) {
      return 'The admin account cannot be deleted.';
    }

    if (raw.includes('Not allowed')) {
      return 'Admin access required.';
    }

    return 'Could not update the player.';
  }

  const pinText = accessGate.querySelector<HTMLElement>('[data-pin-text]');
  const pinCopy =
    'Unlock your column to add scores, or use the guest PIN to view the table. Other players’ ratings stay locked.';
  const switchPinCopy =
    'Enter another PIN to switch columns. Close to stay signed in.';
  let pinGateDismissible = false;

  function setPinError(message: string): void {
    if (pinError) {
      pinError.textContent = message;
    }
  }

  function showGate(options?: { dismissible?: boolean }): void {
    pinGateDismissible = Boolean(options?.dismissible && session);
    accessGate.hidden = false;
    accessGate.classList.toggle('is-overlay', pinGateDismissible);
    accessGate.classList.toggle('is-dismissible', pinGateDismissible);
    accessBoard.classList.toggle('is-locked', !pinGateDismissible);
    if (pinText) {
      pinText.textContent = pinGateDismissible ? switchPinCopy : pinCopy;
    }
    accessForm.reset();
    setPinError('');
    const pinInput = accessForm.querySelector<HTMLInputElement>('input');
    pinInput?.focus();
  }

  function hideGate(): void {
    pinGateDismissible = false;
    accessGate.hidden = true;
    accessGate.classList.remove('is-overlay', 'is-dismissible');
    accessBoard.classList.remove('is-locked');
    accessForm.reset();
    setPinError('');
    if (pinText) {
      pinText.textContent = pinCopy;
    }
  }

  function closePinGate(): void {
    if (!pinGateDismissible || !session) {
      return;
    }

    hideGate();
    setStatus(session.isGuest ? sessionStatus(session) : `Signed in as ${session.name}.`);
  }

  function applySession(next: PlayerSession): void {
    session = next;
    saveSessionToken(next.sessionToken);
    hideGate();
    if (playerLabel) {
      playerLabel.textContent = next.isGuest
        ? 'Viewing as Guest'
        : `Signed in as ${next.name}`;
    }
    syncSessionControls();
  }

  function lockSession(): void {
    session = null;
    clearSessionToken();
    if (playerLabel) {
      playerLabel.textContent = '';
    }
    syncSessionControls();
    showGate();
    render();
    setStatus('Enter your PIN to edit your column, or the guest PIN to view.');
  }

  function syncTableScroll(): void {
    if (!(tableScroll instanceof HTMLElement)) {
      return;
    }

    const hasOverflow = tableScroll.scrollWidth > tableScroll.clientWidth + 1;
    tableScroll.classList.toggle('is-scrollable', hasOverflow);
  }

  function hideSuggest(): void {
    suggestAbort?.abort();
    suggestAbort = null;
    if (suggestTimer) {
      window.clearTimeout(suggestTimer);
      suggestTimer = 0;
    }
    suggestGameId = null;
    suggestItems = [];
    suggestIndex = -1;
    suggestRoot.hidden = true;
    suggestRoot.replaceChildren();
  }

  function positionSuggest(input: HTMLInputElement): void {
    const rect = input.getBoundingClientRect();
    suggestRoot.style.top = `${rect.bottom + 4}px`;
    suggestRoot.style.left = `${rect.left}px`;
    suggestRoot.style.width = `${Math.max(rect.width, 280)}px`;
  }

  function syncSuggestPosition(): void {
    if (suggestRoot.hidden) {
      return;
    }

    const active = document.activeElement;
    if (
      !(active instanceof HTMLInputElement) ||
      active.dataset.field !== 'title'
    ) {
      hideSuggest();
      return;
    }

    positionSuggest(active);
  }

  function highlightSuggest(): void {
    suggestRoot.querySelectorAll<HTMLButtonElement>('button').forEach((button, index) => {
      button.classList.toggle('is-active', index === suggestIndex);
    });
  }

  function setGameCover(gameId: string, bannerUrl: string): void {
    const frame = boardTable.querySelector(
      `[data-game-row="${gameId}"] .ratings__cover-frame`,
    );
    if (!(frame instanceof HTMLElement)) {
      return;
    }

    frame.classList.toggle('is-empty', !bannerUrl);
    frame.replaceChildren();
    if (!bannerUrl) {
      return;
    }

    frame.append(
      el('img', {
        className: 'ratings__cover',
        attrs: {
          src: bannerUrl,
          alt: '',
        },
      }),
    );
  }

  function applySuggestion(gameId: string, suggestion: GameSuggestion): void {
    const game = findGame(gameId);
    if (!game || !session) {
      return;
    }

    if (isDuplicateTitle(suggestion.title, gameId)) {
      hideSuggest();
      notifyDuplicate(suggestion.title);
      return;
    }

    skipTitlePersist = true;
    game.title = suggestion.title;
    game.bannerUrl = suggestion.bannerUrl;

    const input = boardTable.querySelector<HTMLInputElement>(
      `[data-field="title"][data-game="${gameId}"]`,
    );
    if (input) {
      input.value = suggestion.title;
    }

    hideSuggest();
    void persistGame(gameId, suggestion.title, suggestion.bannerUrl).finally(
      () => {
        skipTitlePersist = false;
      },
    );
    setStatus(`Selected ${suggestion.title}.`);
  }

  function showSuggest(
    input: HTMLInputElement,
    gameId: string,
    items: GameSuggestion[],
  ): void {
    const available = items.filter(
      (item) => !isDuplicateTitle(item.title, gameId),
    );

    suggestGameId = gameId;
    suggestItems = available;
    suggestIndex = available.length ? 0 : -1;
    suggestRoot.replaceChildren();

    if (!available.length) {
      showSuggestMessage(
        input,
        gameId,
        items.length
          ? 'This game is already on the list.'
          : 'No matches. Keep typing or use a custom title.',
      );
      return;
    }

    available.forEach((item, index) => {
      const option = el('li', { attrs: { role: 'none' } });
      const button = el('button', {
        className:
          index === suggestIndex
            ? 'ratings__suggest-item is-active'
            : 'ratings__suggest-item',
        attrs: {
          type: 'button',
          role: 'option',
        },
      });

      const thumb = el('span', {
        className: item.bannerUrl
          ? 'ratings__suggest-thumb'
          : 'ratings__suggest-thumb is-empty',
      });
      if (item.bannerUrl) {
        thumb.append(
          el('img', {
            attrs: {
              src: item.bannerUrl,
              alt: '',
            },
          }),
        );
      }

      button.append(
        thumb,
        el('span', {
          className: 'ratings__suggest-name',
          text: item.title,
        }),
      );
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        applySuggestion(gameId, item);
      });
      option.append(button);
      suggestRoot.append(option);
    });

    suggestRoot.hidden = false;
    positionSuggest(input);
  }

  function showSuggestMessage(
    input: HTMLInputElement,
    gameId: string,
    message: string,
  ): void {
    suggestGameId = gameId;
    suggestItems = [];
    suggestIndex = -1;
    suggestRoot.replaceChildren();
    suggestRoot.append(
      el('li', {
        className: 'ratings__suggest-empty',
        text: message,
      }),
    );
    suggestRoot.hidden = false;
    positionSuggest(input);
  }

  function scheduleGameSearch(input: HTMLInputElement, gameId: string): void {
    if (skipSuggest) {
      skipSuggest = false;
      hideSuggest();
      return;
    }

    if (suggestTimer) {
      window.clearTimeout(suggestTimer);
    }

    suggestTimer = window.setTimeout(() => {
      suggestTimer = 0;
      const query = input.value.trim();
      if (query.length < 2) {
        hideSuggest();
        return;
      }

      suggestAbort?.abort();
      const controller = new AbortController();
      suggestAbort = controller;
      showSuggestMessage(input, gameId, 'Searching…');

      void (async () => {
        try {
          const items = await searchGames(query, controller.signal);
          if (controller.signal.aborted || document.activeElement !== input) {
            return;
          }
          showSuggest(input, gameId, items);
        } catch {
          if (controller.signal.aborted) {
            return;
          }
          showSuggestMessage(input, gameId, 'Could not search games. Try again.');
        }
      })();
    }, 280);
  }

  function render(): void {
    hideSuggest();
    syncSessionControls();
    syncSortButtons();

    const caption = el('caption', {
      className: 'visually-hidden',
      text: 'Game ratings table',
    });

    const thead = el('thead');
    const headerRow = el('tr');
    headerRow.append(
      el('th', {
        className: 'ratings__game',
        text: 'Game',
        attrs: { scope: 'col' },
      }),
    );

    board.raters.forEach((rater) => {
      const th = el('th', {
        className: 'ratings__rater',
        attrs: { scope: 'col' },
      });
      th.append(
        el('span', {
          className:
            rater.id === session?.id
              ? 'ratings__rater-name is-active'
              : 'ratings__rater-name',
          text: rater.name,
        }),
      );
      headerRow.append(th);
    });

    if (isAdmin()) {
      const actionsHead = el('th', {
        className: 'ratings__actions',
        attrs: { scope: 'col' },
      });
      actionsHead.append(
        el('span', {
          className: 'visually-hidden',
          text: 'Actions',
        }),
      );
      headerRow.append(actionsHead);
    }
    thead.append(headerRow);

    const tbody = el('tbody');
    const games = visibleGames();

    if (!board.games.length) {
      const emptyRow = el('tr');
      const emptyCell = el('td', {
        className: 'ratings__empty',
        text: isGuest()
          ? 'No games yet.'
          : 'No games yet. Click “Add game” to create a row.',
        attrs: {
          colspan: String(board.raters.length + (isAdmin() ? 2 : 1)),
        },
      });
      emptyRow.append(emptyCell);
      tbody.append(emptyRow);
    } else if (!games.length) {
      const emptyRow = el('tr');
      const emptyCell = el('td', {
        className: 'ratings__empty',
        text: 'No games match this search.',
        attrs: {
          colspan: String(board.raters.length + (isAdmin() ? 2 : 1)),
        },
      });
      emptyRow.append(emptyCell);
      tbody.append(emptyRow);
    }

    games.forEach((game) => {
      const row = el('tr', { attrs: { 'data-game-row': game.id } });
      const titleCell = el('th', {
        className: 'ratings__game',
        attrs: { scope: 'row' },
      });
      const picker = el('div', { className: 'ratings__game-pick' });
      const coverFrame = el('div', {
        className: game.bannerUrl
          ? 'ratings__cover-frame'
          : 'ratings__cover-frame is-empty',
      });
      if (game.bannerUrl) {
        coverFrame.append(
          el('img', {
            className: 'ratings__cover',
            attrs: {
              src: game.bannerUrl,
              alt: '',
            },
          }),
        );
      }
      const titleMeta = el('div', { className: 'ratings__game-meta' });
      titleMeta.append(
        canMutate() && !game.title.trim()
          ? el('input', {
              className: 'ratings__title-input',
              attrs: {
                type: 'text',
                value: game.title,
                maxlength: '80',
                placeholder: 'Search game',
                'data-field': 'title',
                'data-game': game.id,
                'aria-label': 'Game title',
                'aria-autocomplete': 'list',
                autocomplete: 'off',
              },
            })
          : createTitleText(game),
      );
      const addedDate = createAddedDate(game);
      if (addedDate) {
        titleMeta.append(addedDate);
      }
      picker.append(coverFrame, titleMeta);
      titleCell.append(picker);
      row.append(titleCell);

      board.raters.forEach((rater) => {
        const score = game.ratings[rater.id] ?? null;
        const cell = el('td', { className: 'ratings__rater' });

        if (!canEditColumn(rater.id)) {
          cell.append(createScoreLocked(game, rater, score));
        } else if (score === null) {
          cell.append(createScoreInput(game, rater, null));
        } else {
          cell.append(createScoreValue(game, rater, score));
        }

        row.append(cell);
      });

      if (isAdmin()) {
        const actionsCell = el('td', { className: 'ratings__actions' });
        actionsCell.append(
          el('button', {
            className: 'ratings__icon-btn',
            text: '×',
            attrs: {
              type: 'button',
              'data-action': 'delete-game',
              'data-game': game.id,
              'aria-label': `Delete game ${game.title || ''}`.trim(),
            },
          }),
        );
        row.append(actionsCell);
      }
      tbody.append(row);
    });

    boardTable.replaceChildren(caption, thead, tbody);
    syncTableScroll();
  }

  async function refreshBoard(): Promise<void> {
    if (refreshing) {
      refreshQueued = true;
      return;
    }

    refreshing = true;
    try {
      const active = document.activeElement;
      const restore =
        active instanceof HTMLInputElement && boardTable.contains(active)
          ? {
              field: active.dataset.field ?? '',
              game: active.dataset.game ?? '',
              rater: active.dataset.rater ?? '',
              value: active.value,
              start: active.selectionStart,
              end: active.selectionEnd,
            }
          : null;

      board = await loadBoard();
      render();

      if (!restore) {
        return;
      }

      const selector = restore.rater
        ? `[data-field="${restore.field}"][data-game="${restore.game}"][data-rater="${restore.rater}"]`
        : `[data-field="${restore.field}"][data-game="${restore.game}"]`;
      const input = boardTable.querySelector<HTMLInputElement>(selector);
      if (!input) {
        return;
      }

      input.value = restore.value;
      input.classList.toggle(
        'is-filled',
        restore.field === 'title' && restore.value.trim().length > 0,
      );
      input.focus();
      if (restore.start !== null && restore.end !== null) {
        input.setSelectionRange(restore.start, restore.end);
      }
    } finally {
      refreshing = false;
      if (refreshQueued) {
        refreshQueued = false;
        void refreshBoard();
      }
    }
  }

  async function persistGame(
    gameId: string,
    title: string,
    bannerUrl?: string,
  ): Promise<void> {
    if (!session || !canMutate()) {
      return;
    }

    if (isDuplicateTitle(title, gameId)) {
      notifyDuplicate(title);
      board = await loadBoard();
      render();
      return;
    }

    try {
      await updateGame(session.sessionToken, gameId, title, bannerUrl);
      const game = findGame(gameId);
      if (game) {
        game.title = title.trim();
        if (bannerUrl !== undefined) {
          game.bannerUrl = bannerUrl;
        }
      }

      if (title.trim()) {
        render();
      }
    } catch (error) {
      const message =
        error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message)
          : '';

      if (message.includes('Game already exists')) {
        notifyDuplicate(title);
        board = await loadBoard();
        render();
        return;
      }

      setStatus('Could not save the game title.');
    }
  }

  async function persistScore(
    gameId: string,
    raterId: string,
    score: number | null,
  ): Promise<void> {
    if (!session || session.id !== raterId || !canMutate()) {
      return;
    }

    try {
      await setRating(session.sessionToken, gameId, score);
    } catch {
      setStatus('Could not save the rating.');
    }
  }

  async function maybeImportLegacyBoard(): Promise<void> {
    if (!session?.isAdmin || board.games.length > 0) {
      return;
    }

    const legacyGames = loadLegacyBoard();
    if (!legacyGames.length) {
      return;
    }

    try {
      await importBoard(session.sessionToken, legacyGames);
      clearLegacyBoard();
      board = await loadBoard();
      render();
      setStatus('Imported your local table into Supabase.');
    } catch {
      setStatus('Could not import the local table.');
    }
  }

  async function addGame(): Promise<void> {
    if (!session || !canMutate()) {
      return;
    }

    try {
      const created = await addGameRemote(session.sessionToken);
      board = await loadBoard();
      render();

      const titleInput = boardTable.querySelector<HTMLInputElement>(
        `[data-field="title"][data-game="${created.id}"]`,
      );
      titleInput?.focus();
      setStatus(
        'Row added. Enter the game title and a score in a player column.',
      );
    } catch {
      setStatus('Could not add a game.');
    }
  }

  function onFieldInput(target: HTMLInputElement): void {
    const field = target.dataset.field;
    const gameId = target.dataset.game;
    const raterId = target.dataset.rater;

    if (field === 'title' && gameId) {
      const game = findGame(gameId);
      if (game) {
        game.title = target.value;
      }
      target.classList.toggle('is-filled', target.value.trim().length > 0);
      scheduleGameSearch(target, gameId);
      return;
    }

    if (field === 'score' && gameId && raterId) {
      if (!canEditColumn(raterId)) {
        return;
      }

      if (!target.value.trim()) {
        target.className = scoreClass(null);
        return;
      }

      const sanitized = sanitizeScoreInput(target.value);
      if (target.value !== sanitized) {
        const hadDot = target.value.replace(/,/g, '.').includes('.');
        target.value = sanitized;
        if (!hadDot && sanitized.includes('.')) {
          const end = sanitized.length;
          target.setSelectionRange(end, end);
        }
      }

      if (!sanitized || sanitized.endsWith('.')) {
        target.className = scoreClass(null);
        return;
      }

      const score = parseScore(sanitized);
      target.className = scoreClass(score);
    }
  }

  addGameButtons.forEach((button) => {
    button.addEventListener('click', () => {
      void addGame();
    });
  });

  listSearch.addEventListener('input', () => {
    listQuery = listSearch.value;
    render();
    listSearch.focus();
  });

  listSearch.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !listQuery) {
      return;
    }

    event.preventDefault();
    listQuery = '';
    listSearch.value = '';
    render();
    listSearch.focus();
  });

  sortButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const next = button.dataset.sort;
      if (next !== 'name' && next !== 'date' && next !== 'rating') {
        return;
      }

      listSort = next;
      render();
      const label =
        next === 'date' ? 'date' : next === 'rating' ? 'rating' : 'name';
      setStatus(`Sorted by ${label}.`);
    });
  });

  playerButton.addEventListener('click', () => {
    openAdminModal();
  });

  playersModal.querySelectorAll('[data-action="close-admin"]').forEach((node) => {
    node.addEventListener('click', () => {
      closeAdminModal();
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }

    if (!playersModal.hidden) {
      closeAdminModal();
      return;
    }

    closePinGate();
  });

  accessGate.querySelectorAll('[data-action="close-pin"]').forEach((node) => {
    node.addEventListener('click', () => {
      closePinGate();
    });
  });

  const addPlayerPinInput = playerForm.querySelector<HTMLInputElement>(
    'input[name="pin"]',
  );
  const addPlayerPinButton = playerForm.querySelector<HTMLButtonElement>(
    '[data-action="generate-pin"]',
  );
  if (addPlayerPinInput) {
    bindPinDigits(addPlayerPinInput);
    if (addPlayerPinButton) {
      bindPinGenerate(addPlayerPinInput, addPlayerPinButton);
    }
  }

  playerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!isAdmin() || !session) {
      return;
    }

    const data = new FormData(playerForm);
    const name = String(data.get('name') ?? '').trim();
    const pin = String(data.get('pin') ?? '').replace(/\D/g, '');
    const token = session.sessionToken;

    if (!name) {
      setPlayerError('Enter a player name.');
      return;
    }

    if (pin.length !== 4) {
      setPlayerError('PIN must be 4 digits.');
      return;
    }

    void (async () => {
      try {
        const created = await addPlayerRemote(token, name, pin);
        playerForm.reset();
        if (addPlayerPinInput) {
          addPlayerPinInput.type = 'password';
        }
        board = await loadBoard();
        render();
        renderAdminPlayers();
        setPlayerError('');
        setStatus(`Player added: ${created.name}.`);
      } catch (error) {
        setPlayerError(playerErrorMessage(error));
      }
    })();
  });

  switchButton.addEventListener('click', () => {
    if (!session) {
      lockSession();
      return;
    }

    closeAdminModal();
    showGate({ dismissible: true });
    setStatus('Enter another PIN to switch, or close to stay signed in.');
  });

  const pinInput =
    accessForm.querySelector<HTMLInputElement>('input[name="pin"]');
  pinInput?.addEventListener('input', () => {
    const digits = pinInput.value.replace(/\D/g, '').slice(0, 4);
    if (pinInput.value !== digits) {
      pinInput.value = digits;
    }
  });

  accessForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(accessForm);
    const pin = String(data.get('pin') ?? '');

    void (async () => {
      try {
        const next = await unlockWithPin(pin);
        if (!next) {
          setPinError('Unknown PIN. Try again.');
          return;
        }

        applySession(next);
        render();
        await maybeImportLegacyBoard();
        setStatus(sessionStatus(next));
      } catch {
        setPinError(
          isSupabaseConfigured()
            ? 'Could not check the PIN. Try again.'
            : 'This deploy is missing Supabase keys.',
        );
      }
    })();
  });

  shareButton.addEventListener('click', async () => {
    const url = new URL(window.location.href);
    url.hash = '';
    const shareUrl = url.toString();

    try {
      await navigator.clipboard.writeText(shareUrl);
      setStatus('Link copied. Everyone sees the same live table.');
    } catch {
      window.prompt('Copy this table link:', shareUrl);
    }
  });

  boardTable.addEventListener('input', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      onFieldInput(target);
    }
  });

  function finishScoreEdit(target: HTMLInputElement): void {
    if (!target.isConnected) {
      return;
    }

    const gameId = target.dataset.game;
    const raterId = target.dataset.rater;
    const game = gameId ? findGame(gameId) : undefined;
    const rater = raterId ? findRater(raterId) : undefined;
    if (!game || !rater || !canEditColumn(rater.id)) {
      return;
    }

    const score = parseScore(target.value);
    game.ratings[rater.id] = score;
    void persistScore(game.id, rater.id, score);

    if (score === null) {
      target.value = '';
      target.className = scoreClass(null);
      return;
    }

    target.replaceWith(createScoreValue(game, rater, score));
  }

  boardTable.addEventListener('focusout', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.dataset.field === 'score') {
      finishScoreEdit(target);
      return;
    }

    if (target.dataset.field === 'title' && target.dataset.game) {
      window.setTimeout(() => {
        if (!suggestRoot.contains(document.activeElement)) {
          hideSuggest();
        }
      }, 120);

      if (skipTitlePersist) {
        return;
      }

      void persistGame(target.dataset.game, target.value);
    }
  });

  boardTable.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement | null)?.closest('button');
    if (!target) {
      return;
    }

    const action = target.dataset.action;

    if (
      action === 'edit-score' &&
      target.dataset.game &&
      target.dataset.rater
    ) {
      const game = findGame(target.dataset.game);
      const rater = findRater(target.dataset.rater);
      if (!game || !rater || !canEditColumn(rater.id)) {
        return;
      }

      const score = game.ratings[rater.id] ?? null;
      const input = createScoreInput(game, rater, score);
      target.replaceWith(input);
      input.focus();
      input.select();
      return;
    }

    if (action === 'delete-game' && target.dataset.game) {
      if (!isAdmin() || !session) {
        return;
      }

      const gameId = target.dataset.game;
      const token = session.sessionToken;
      void (async () => {
        try {
          await deleteGameRemote(token, gameId);
          board.games = board.games.filter((game) => game.id !== gameId);
          render();
          setStatus('Game deleted.');
        } catch {
          setStatus('Could not delete the game.');
        }
      })();
    }
  });

  boardTable.addEventListener('keydown', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.dataset.field === 'title' && !suggestRoot.hidden) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        suggestIndex = Math.min(suggestItems.length - 1, suggestIndex + 1);
        highlightSuggest();
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        suggestIndex = Math.max(0, suggestIndex - 1);
        highlightSuggest();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        hideSuggest();
        return;
      }

      if (event.key === 'Enter' && suggestIndex >= 0 && suggestGameId) {
        const suggestion = suggestItems[suggestIndex];
        if (suggestion) {
          event.preventDefault();
          applySuggestion(suggestGameId, suggestion);
          return;
        }
      }
    }

    if (event.key !== 'Enter') {
      return;
    }

    if (target.dataset.field === 'title' || target.dataset.field === 'score') {
      event.preventDefault();
      target.blur();
    }
  });

  render();
  window.addEventListener('resize', () => {
    syncTableScroll();
    syncSuggestPosition();
  });
  window.addEventListener('scroll', syncSuggestPosition, true);

  if (tableScroll instanceof HTMLElement) {
    tableScroll.addEventListener('scroll', syncSuggestPosition);
    const resizeObserver = new ResizeObserver(() => {
      syncTableScroll();
    });
    resizeObserver.observe(tableScroll);
  }

  if (!isSupabaseConfigured()) {
    showGate();
    setStatus(
      'Missing Supabase config. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    );
    return;
  }

  subscribeToBoard(() => {
    const active = document.activeElement;
    if (
      active instanceof HTMLInputElement &&
      (active.dataset.field === 'title' || active.dataset.field === 'score')
    ) {
      return;
    }
    void refreshBoard();
  });

  void (async () => {
    try {
      setStatus('Loading board…');
      board = await loadBoard();

      const savedToken = loadSessionToken();
      if (savedToken) {
        const restored = await restoreSession(savedToken);
        if (restored) {
          applySession(restored);
          render();
          await maybeImportLegacyBoard();
          setStatus(sessionStatus(restored));
          return;
        }

        clearSessionToken();
      }

      render();
      lockSession();
    } catch {
      showGate();
      setStatus('Could not load the board from Supabase.');
    }
  })();
}
