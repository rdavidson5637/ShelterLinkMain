const button = document.querySelector('button');
if (button) {
  button.addEventListener('click', () => window.location.reload());
}
window.addEventListener('online', () => {
  window.location.reload();
});
