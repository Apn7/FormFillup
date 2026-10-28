import { routeMessage } from '../lib/llm/router';

export default defineBackground(() => {
  // Returning the promise (or undefined for foreign messages) works in Chrome and Firefox MV3.
  browser.runtime.onMessage.addListener((message) => routeMessage(message));

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') void browser.runtime.openOptionsPage();
  });
});
