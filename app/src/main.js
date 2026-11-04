import { App } from './App.js';

const params = new URLSearchParams(location.search);
const app = new App(params);
app.start().catch((e) => {
  console.error(e);
  const m = document.getElementById('ldMsg');
  if (m) m.textContent = `Something went wrong: ${e.message}`;
});
