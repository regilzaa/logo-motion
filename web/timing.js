// Loads the single shared timing file. Every module reads times from here.
export let T = null;
export async function loadTiming() {
  T = await (await fetch('/timing.json')).json();
  return T;
}
