import { ref } from 'vue';

/** 轻量 hash 路由：#/catalog、#/catalog/new、#/catalog/:id、#/media、#/platform 等。 */
function parseHash(): string {
  const raw = location.hash.replace(/^#/, '').split('?')[0]!;
  return raw.startsWith('/') ? raw : '/platform';
}

export const currentPath = ref(parseHash());

window.addEventListener('hashchange', () => {
  currentPath.value = parseHash();
});

export function navigate(path: string): void {
  location.hash = `#${path}`;
}

export function useRouter() {
  return {
    path: currentPath,
    push: navigate
  };
}
