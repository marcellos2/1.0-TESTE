// Armazena o estado de rotação de cada imagem em graus (0, 90, 180, 270)
const photoRotations = {
  photo1: 0,
  photo2: 0,
  photo3: 0,
};

// Cache do Tesseract worker para melhor performance
let tesseractWorker = null;

// Inicializa o worker do Tesseract de forma lazy
async function initTesseractWorker() {
  if (!tesseractWorker) {
    tesseractWorker = await Tesseract.createWorker('por+eng', 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
        }
      }
    });
    
    await tesseractWorker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ÀÁÂÃÇÉÊÍÓÔÕÚàáâãçéêíóôõú ',
    });
  }
  return tesseractWorker;
}

// Carrega as fotos nos respectivos blocos
async function loadPhoto(input, photoId) {
  if (!input.files || !input.files.length) return;
  
  const file = input.files[0];
  const reader = new FileReader();
  
  reader.onload = async (e) => {
    const imgElement = document.getElementById(photoId);
    imgElement.src = e.target.result;
    
    // Resetar a rotação ao carregar uma nova foto
    photoRotations[photoId] = 0;
    
    // Verificar se a rotação automática está habilitada
    const autoRotateEnabled = document.getElementById('autoRotateToggle').checked;
    
    if (autoRotateEnabled) {
      // Usar setTimeout para não bloquear a interface
      setTimeout(() => {
        detectAndRotateImage(photoId, e.target.result);
      }, 100);
    }
  };
  
  reader.readAsDataURL(file);
}

// Detecta a orientação do texto e rotaciona automaticamente (versão otimizada)
async function detectAndRotateImage(photoId, imageSrc) {
  try {
    showLoading(photoId);
    showProcessingStatus('Analisando orientação da imagem...');
    
    // Usar uma versão reduzida da imagem para análise mais rápida
    const resizedImage = await resizeImageForAnalysis(imageSrc, 400);
    
    // Testar apenas rotações mais prováveis primeiro (0° e 180°)
    const quickTest = await quickOrientationTest(resizedImage);
    
    if (quickTest.confidence > 0.7) {
      // Se a confiança for alta, usar o resultado rápido
      if (quickTest.angle !== 0) {
        await applyRotation(photoId, imageSrc, quickTest.angle);
      }
    } else {
      // Se a confiança for baixa, fazer teste completo
      const fullTest = await fullOrientationTest(resizedImage);
      if (fullTest.angle !== 0 && fullTest.confidence > 0.4) {
        await applyRotation(photoId, imageSrc, fullTest.angle);
      }
    }
    
  } catch (error) {
    console.error('Erro na detecção automática:', error);
  } finally {
    hideLoading(photoId);
    hideProcessingStatus();
  }
}

// Teste rápido de orientação (apenas 0° e 180°)
async function quickOrientationTest(imageSrc) {
  const angles = [0, 180];
  const results = [];
  
  for (let angle of angles) {
    const rotatedImage = await rotateImageForAnalysis(imageSrc, angle);
    const confidence = await analyzeTextOrientation(rotatedImage, true); // modo rápido
    results.push({ angle, confidence });
  }
  
  return results.reduce((prev, current) => 
    (prev.confidence > current.confidence) ? prev : current
  );
}

// Teste completo de orientação (todas as 4 rotações)
async function fullOrientationTest(imageSrc) {
  const angles = [0, 90, 180, 270];
  const results = [];
  
  for (let angle of angles) {
    const rotatedImage = await rotateImageForAnalysis(imageSrc, angle);
    const confidence = await analyzeTextOrientation(rotatedImage, false); // modo completo
    results.push({ angle, confidence });
  }
  
  return results.reduce((prev, current) => 
    (prev.confidence > current.confidence) ? prev : current
  );
}

// Redimensiona imagem para análise mais rápida
function resizeImageForAnalysis(imageSrc, maxWidth) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Calcular novo tamanho mantendo proporção
      const ratio = Math.min(maxWidth / img.naturalWidth, maxWidth / img.naturalHeight);
      const newWidth = img.naturalWidth * ratio;
      const newHeight = img.naturalHeight * ratio;
      
      canvas.width = newWidth;
      canvas.height = newHeight;
      
      ctx.drawImage(img, 0, 0, newWidth, newHeight);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.src = imageSrc;
  });
}

// Aplica a rotação final na imagem
async function applyRotation(photoId, originalImageSrc, angle) {
  if (angle !== 0) {
    const rotatedImage = await rotateImageForAnalysis(originalImageSrc, angle);
    document.getElementById(photoId).src = rotatedImage;
    photoRotations[photoId] = angle;
    console.log(`Rotação aplicada: ${angle}° para ${photoId}`);
  }
}

// Rotaciona uma imagem para análise
function rotateImageForAnalysis(imageSrc, angle) {
  return new Promise((resolve) => {
    const tempImg = new Image();
    tempImg.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      let canvasWidth = tempImg.naturalWidth;
      let canvasHeight = tempImg.naturalHeight;

      if (angle === 90 || angle === 270) {
        canvasWidth = tempImg.naturalHeight;
        canvasHeight = tempImg.naturalWidth;
      }

      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

      ctx.translate(canvasWidth / 2, canvasHeight / 2);
      ctx.rotate(angle * Math.PI / 180);
      ctx.drawImage(tempImg, -tempImg.naturalWidth / 2, -tempImg.naturalHeight / 2);

      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    tempImg.src = imageSrc;
  });
}

// Analisa a orientação do texto usando OCR (versão otimizada)
async function analyzeTextOrientation(imageSrc, fastMode = false) {
  try {
    const worker = await initTesseractWorker();
    
    const options = {
      tessedit_pageseg_mode: fastMode ? Tesseract.PSM.SINGLE_BLOCK : Tesseract.PSM.AUTO,
    };
    
    const { data: { text, confidence } } = await worker.recognize(imageSrc, options);
    
    // Calcular pontuação otimizada
    const textLength = text.trim().length;
    const wordCount = text.trim().split(/\s+/).filter(word => word.length > 2).length;
    const hasReadableWords = /[a-zA-ZÀ-ÿ]{3,}/.test(text);
    
    let score = 0;
    
    // Pontuação baseada na confiança do OCR (peso maior)
    score += (confidence / 100) * 0.6;
    
    // Pontuação baseada na quantidade de texto
    score += Math.min(textLength / 30, 0.25);
    
    // Pontuação baseada no número de palavras
    score += Math.min(wordCount / 3, 0.15);
    
    // Bônus para palavras legíveis
    if (hasReadableWords) {
      score += 0.2;
    }
    
    return Math.min(score, 1.0);
    
  } catch (error) {
    console.error('Erro na análise OCR:', error);
    return 0;
  }
}

// Rotação automática manual (acionada pelo botão)
async function autoRotatePhoto(photoId) {
  const imgElement = document.getElementById(photoId);
  const currentSrc = imgElement.src;
  
  if (!currentSrc || !currentSrc.startsWith('data:')) {
    alert('Carregue uma imagem primeiro!');
    return;
  }
  
  // Desabilitar botão durante processamento
  const button = event.target;
  button.disabled = true;
  button.textContent = '⏳';
  
  try {
    await detectAndRotateImage(photoId, currentSrc);
  } finally {
    button.disabled = false;
    button.textContent = '🤖 Auto';
  }
}

// Funções de interface
function showLoading(photoId) {
  const loadingElement = document.getElementById(`loading${photoId.slice(-1)}`);
  if (loadingElement) {
    loadingElement.style.display = 'flex';
  }
}

function hideLoading(photoId) {
  const loadingElement = document.getElementById(`loading${photoId.slice(-1)}`);
  if (loadingElement) {
    loadingElement.style.display = 'none';
  }
}

function showProcessingStatus(message) {
  let statusDiv = document.getElementById('processing-status');
  if (!statusDiv) {
    statusDiv = document.createElement('div');
    statusDiv.id = 'processing-status';
    statusDiv.className = 'processing-status';
    document.body.appendChild(statusDiv);
  }
  statusDiv.textContent = message;
  statusDiv.classList.add('show');
}

function hideProcessingStatus() {
  const statusDiv = document.getElementById('processing-status');
  if (statusDiv) {
    statusDiv.classList.remove('show');
  }
}

// Abre o input de upload
function triggerUpload(num) {
  document.getElementById(`upload${num}`).click();
}

// Rotação manual em 90 graus
function rotatePhoto(photoId) {
  const imgElement = document.getElementById(photoId);
  const currentSrc = imgElement.src;

  if (!currentSrc || !currentSrc.startsWith('data:')) {
    console.warn('Nenhuma imagem para girar em ' + photoId);
    return;
  }

  photoRotations[photoId] = (photoRotations[photoId] + 90) % 360;
  const rotationAngle = photoRotations[photoId];

  const tempImg = new Image();
  tempImg.onload = () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    let canvasWidth = tempImg.naturalWidth;
    let canvasHeight = tempImg.naturalHeight;

    if (rotationAngle === 90 || rotationAngle === 270) {
      canvasWidth = tempImg.naturalHeight;
      canvasHeight = tempImg.naturalWidth;
    }

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    ctx.translate(canvasWidth / 2, canvasHeight / 2);
    ctx.rotate(rotationAngle * Math.PI / 180);
    ctx.drawImage(tempImg, -tempImg.naturalWidth / 2, -tempImg.naturalHeight / 2);

    imgElement.src = canvas.toDataURL('image/png');
  };
  tempImg.src = currentSrc;
}

// Salva o relatório
function saveReport() {
  html2canvas(document.querySelector("#captureArea"), {
    scale: 2,
    backgroundColor: "#ffffff",
    logging: false
  }).then(canvas => {
    const link = document.createElement('a');
    link.download = 'registro-fotografico.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
}

// Inicialização
document.addEventListener('DOMContentLoaded', function() {
  // Esconder loading overlays
  ['loading1', 'loading2', 'loading3'].forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.style.display = 'none';
    }
  });
  
  // Pré-carregar o worker do Tesseract em background (opcional)
  setTimeout(() => {
    if (document.getElementById('autoRotateToggle').checked) {
      initTesseractWorker().then(() => {
        console.log('Tesseract worker pré-carregado');
      });
    }
  }, 2000);
});