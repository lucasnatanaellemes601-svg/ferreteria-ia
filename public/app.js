const btn = document.getElementById('ptt-btn');
const textoEscuchado = document.getElementById('texto-escuchado');
const jsonResultado = document.getElementById('json-resultado');

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SpeechRecognition) {
  alert("Tu navegador no soporta reconocimiento de voz. Usá Chrome o Edge.");
}

const recognition = new SpeechRecognition();
recognition.lang = 'es-AR';
// Muestra el texto en vivo mientras hablás
recognition.interimResults = true; 
// Escucha de forma continua, no se apaga después de una frase
recognition.continuous = true; 

let escuchando = false;

// Con un solo clic lo prendemos para todo el día
btn.addEventListener('click', () => {
  if (!escuchando) {
    recognition.start();
    escuchando = true;
    btn.innerText = "🔴 Escuchando de fondo... (Click para apagar)";
    btn.classList.add('grabando');
  } else {
    recognition.stop();
    escuchando = false;
    btn.innerText = "Activar micrófono automático";
    btn.classList.remove('grabando');
  }
});

recognition.onresult = (event) => {
  let textoFinal = "";
  let textoTemporal = "";

  for (let i = event.resultIndex; i < event.results.length; ++i) {
    if (event.results[i].isFinal) {
      textoFinal += event.results[i][0].transcript;
    } else {
      textoTemporal += event.results[i][0].transcript;
    }
  }

  // Muestra lo que vas diciendo en tiempo real
  textoEscuchado.innerText = textoFinal + textoTemporal;

  // Cuando hacés una pausa y la frase está completa (isFinal), la manda a la IA
  if (textoFinal.trim() !== "") {
     enviarAInteligencia(textoFinal);
  }
};

// Si el navegador apaga el micrófono por inactividad, lo volvemos a prender automáticamente
recognition.onend = () => {
  if (escuchando) {
    recognition.start();
  }
};

recognition.onerror = (event) => {
  console.error("Error de micrófono: ", event.error);
  if (event.error === 'not-allowed') {
    escuchando = false;
    btn.innerText = "Error: Permiso denegado por el navegador";
    btn.classList.remove('grabando');
  }
};

async function enviarAInteligencia(texto) {
  jsonResultado.innerText = "⏳ Procesando con IA...";
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
  }
}