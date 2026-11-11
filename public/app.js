const btn = document.getElementById('ptt-btn');
const textoEscuchado = document.getElementById('texto-escuchado');
const jsonResultado = document.getElementById('json-resultado');

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SpeechRecognition) {
  alert("Tu navegador no soporta reconocimiento de voz. Usá Chrome o Edge.");
}

const recognition = new SpeechRecognition();
recognition.lang = 'es-AR';
recognition.interimResults = false;
recognition.continuous = false;

let transcriptFinal = "";

const arrancarGrabacion = (e) => {
  e.preventDefault();
  transcriptFinal = "";
  btn.classList.add('grabando');
  btn.innerText = "🗣️ Escuchando... soltá para enviar";
  recognition.start();
};

const frenarGrabacion = (e) => {
  e.preventDefault();
  btn.classList.remove('grabando');
  btn.innerText = "⏳ Procesando...";
  recognition.stop();
};

btn.addEventListener('mousedown', arrancarGrabacion);
btn.addEventListener('mouseup', frenarGrabacion);
btn.addEventListener('touchstart', arrancarGrabacion, {passive: false});
btn.addEventListener('touchend', frenarGrabacion);

recognition.onresult = (event) => {
  transcriptFinal = event.results[0][0].transcript;
  textoEscuchado.innerText = transcriptFinal;
  enviarAInteligencia(transcriptFinal);
};

recognition.onerror = (event) => {
  btn.innerText = "Mantener apretado para hablar";
  console.error("Error de micrófono: ", event.error);
};

async function enviarAInteligencia(texto) {
  try {
    const res = await fetch('/api/procesar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto })
    });
    
    const data = await res.json();
    jsonResultado.innerText = JSON.stringify(data, null, 2);
  } catch (err) {
    jsonResultado.innerText = "Error conectando con la IA.";
    console.error(err);
  } finally {
    btn.innerText = "Mantener apretado para hablar";
  }
}