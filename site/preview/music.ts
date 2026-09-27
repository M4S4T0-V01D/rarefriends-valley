// Preview page music: the game's own procedural tunes, started from the floating record button.
// Browsers only allow audio after a click, so it never autoplays. The ⏭ button cycles the seasons' tracks.
import { TRACKS, ValleyAudio } from "../../games/rarefriends-valley/audio.ts";

const button = document.getElementById("music") as HTMLButtonElement | null, next = document.getElementById("next-track") as HTMLButtonElement | null;
if (button) {
  const player = new ValleyAudio(), label = button.querySelector<HTMLElement>(".music-label");
  let playing = false, index = 0;
  player.setSfx(false); player.setVolume(0.55); player.setTrack(TRACKS[index].id);
  const show = () => {
    button.setAttribute("aria-pressed", String(playing)); button.classList.toggle("on", playing);
    if (label) label.textContent = playing ? TRACKS[index].name : "Play the valley music";
    if (next) next.hidden = !playing;
  };
  button.addEventListener("click", () => { playing = !playing; player.setMuted(!playing); if (playing) player.unlock(); show(); });
  next?.addEventListener("click", () => { index = (index + 1) % TRACKS.length; player.setTrack(TRACKS[index].id); player.unlock(); show(); });
  // Rest while the tab is hidden, pick the tune back up on return.
  document.addEventListener("visibilitychange", () => { if (!playing) return; player.setMuted(document.hidden); if (!document.hidden) player.unlock(); });
  show();
}
