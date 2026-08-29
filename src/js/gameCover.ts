const STEAM_APP_RE = /\/steam\/apps\/(\d+)\//i;

function addUnique(urls: string[], value?: string): void {
  const url = value?.trim();
  if (url && !urls.includes(url)) {
    urls.push(url);
  }
}

export function steamCoverFallbacks(primary: string, extra?: string): string[] {
  const urls: string[] = [];
  addUnique(urls, primary);
  addUnique(urls, extra);

  const match = primary.match(STEAM_APP_RE) ?? extra?.match(STEAM_APP_RE);
  if (!match) {
    return urls;
  }

  const appId = match[1];
  const bases = [
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${appId}`,
  ];
  const files = ['header.jpg', 'capsule_616x353.jpg', 'capsule_231x87.jpg'];

  bases.forEach((base) => {
    files.forEach((file) => {
      addUnique(urls, `${base}/${file}`);
    });
  });

  return urls;
}

export function bindCoverFallbacks(
  image: HTMLImageElement,
  sources: string[],
): void {
  let index = 0;

  const useNext = (): void => {
    index += 1;
    if (index < sources.length) {
      image.src = sources[index];
      return;
    }

    image.removeEventListener('error', useNext);
    const frame = image.parentElement;
    image.remove();
    frame?.classList.add('is-empty');
  };

  image.addEventListener('error', useNext);

  if (sources[0]) {
    image.src = sources[0];
    return;
  }

  useNext();
}
