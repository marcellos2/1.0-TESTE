// Armazena o estado de rotação de cada imagem em graus (0, 90, 180, 270)
const photoRotations = {
  photo1: 0,
  photo2: 0,
  photo3: 0,
};
// Cache do Tesseract worker para melhor performance
let tesseractWorker = null;

// Configurações da API do Google
const GOOGLE_API_KEY = 'AIzaSyAQorqgDbL8SkEEKbxArrkUrW90Bo3HElA';
const GOOGLE_CLIENT_ID = '413639391505-ju79cikoccl8n4ke361ibv0dtd9q4iji.apps.googleusercontent.com'; // Você precisa obter isso no Google Cloud Console
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/photoslibrary.readonly';

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

// ========== INTEGRAÇÃO COM GOOGLE FOTOS ==========

// Inicializa a API do Google
function initGoogleAPI() {
  return new Promise((resolve, reject) => {
    gapi.load('client:auth2', () => {
      gapi.client.init({
        apiKey: GOOGLE_API_KEY,
        clientId: GOOGLE_CLIENT_ID,
        discoveryDocs: ['https://photoslibrary.googleapis.com/$discovery/rest?version=v1'],
        scope: GOOGLE_SCOPES
      }).then(() => {
        console.log('Google API inicializada');
        resolve();
      }).catch(error => {
        console.error('Erro ao inicializar Google API:', error);
        reject(error);
      });
    });
  });
}

// Verifica se o usuário está autenticado
function isUserAuthenticated() {
  return gapi.auth2.getAuthInstance().isSignedIn.get();
}

// Autentica o usuário
function authenticateUser() {
  return gapi.auth2.getAuthInstance().signIn();
}

// Abre o seletor do Google Fotos
async function triggerGooglePhotos(photoNumber) {
  try {
    // Inicializa a API se ainda não foi inicializada
    if (!gapi.client) {
      await initGoogleAPI();
    }

    // Autentica o usuário se necessário
    if (!isUserAuthenticated()) {
      await authenticateUser();
    }

    // Cria e abre o seletor do Google Fotos
    const googlePhotosPicker = new google.picker.PickerBuilder()
      .addView(google.picker.ViewId.PHOTOS)
      .addView(google.picker.ViewId.PHOTO_ALBUMS)
      .addView(google.picker.ViewId.PHOTO_UPLOAD)
      setOAuthToken(gapi.auth2.getAuthInstance().currentUser.get().getAuthResponse().access_token)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setCallback((data) => {
        if (data[google.picker.Response.ACTION] === google.picker.Action.PICKED) {
          const doc = data[google.picker.Response.DOCUMENTS][0];
          const photoId = doc[google.picker.Document.ID];
          loadPhotoFromGoogle(photoId, `photo${photoNumber}`);
        }
      })
      .build();
    
    googlePhotosPicker.setVisible(true);
  } catch (error) {
    console.error('Erro ao acessar Google Fotos:', error);
    alert('Erro ao acessar Google Fotos. Verifique o console para mais detalhes.');
  }
}

// Carrega uma foto do Google Fotos
async function loadPhotoFromGoogle(photoId, targetPhotoId) {
  try {
    showLoading(targetPhotoId);
    
    // Obtém a URL da foto em alta resolução
    const response = await gapi.client.photoslibrary.mediaItems.get({
      mediaItemId: photoId
    });
    
    const mediaItem = response.result;
    const photoUrl = `${mediaItem.baseUrl}=w1600-h1200`; // Tamanho ajustável
    
    // Carrega a imagem
    const imgElement = document.getElementById(targetPhotoId);
    imgElement.src = photoUrl;
    
    // Resetar a rotação ao carregar uma nova foto
    photoRotations[targetPhotoId] = 0;
    
    // Verificar se a rotação automática está habilitada
    const autoRotateEnabled = document.getElementById('autoRotateToggle');
    
    if (autoRotateEnabled && autoRotateEnabled.checked) {
      // Usar setTimeout para não bloquear a interface
      setTimeout(() => {
        detectAndRotateImage(targetPhotoId, photoUrl);
      }, 100);
    }
  } catch (error) {
    console.error('Erro ao carregar foto do Google:', error);
    alert('Erro ao carregar foto do Google Fotos.');
  } finally {
    hideLoading(targetPhotoId);
  }
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
    const autoRotateEnabled = document.getElementById('autoRotateToggle');
    
    if (autoRotateEnabled && autoRotateEnabled.checked) {
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

// ========== FUNÇÕES DE CÓPIA DE TEXTO ==========

// Função para copiar texto
function copyText(button, textId) {
  const textElement = document.getElementById(textId);
  const text = textElement.textContent.trim();
  
  // Tentar copiar usando a API moderna
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      showCopySuccess(button);
    }).catch(() => {
      fallbackCopy(text, button);
    });
  } else {
    // Fallback para navegadores mais antigos
    fallbackCopy(text, button);
  }
}

// Função de fallback para cópia (navegadores antigos)
function fallbackCopy(text, button) {
  // Criar elemento temporário para seleção
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  document.body.appendChild(textArea);
  
  textArea.focus();
  textArea.select();
  
  try {
    const successful = document.execCommand('copy');
    if (successful) {
      showCopySuccess(button);
    } else {
      showCopyError();
    }
  } catch (err) {
    console.error('Erro ao copiar texto:', err);
    showCopyError();
  } finally {
    document.body.removeChild(textArea);
  }
}

// Mostrar sucesso na cópia
function showCopySuccess(button) {
  // Animação do botão
  const originalText = button.querySelector('.copy-text').textContent;
  button.classList.add('copied');
  button.querySelector('.copy-text').textContent = 'Copiado!';
  button.querySelector('.copy-icon').textContent = '✅';
  
  // Mostrar notificação
  showNotification('✅ Texto copiado com sucesso!', 'success');
  
  // Restaurar botão após 2 segundos
  setTimeout(() => {
    button.classList.remove('copied');
    button.querySelector('.copy-text').textContent = originalText;
    button.querySelector('.copy-icon').textContent = '📋';
  }, 2000);
}

// Mostrar erro na cópia
function showCopyError() {
  showNotification('❌ Erro ao copiar texto. Tente novamente.', 'error');
}

// Mostrar notificação
function showNotification(message, type = 'success') {
  const notification = document.getElementById('copyNotification');
  notification.textContent = message;
  notification.className = 'copy-notification show';
  
  if (type === 'error') {
    notification.style.background = '#f44336';
  } else {
    notification.style.background = '#4CAF50';
  }
  
  // Esconder notificação após 3 segundos
  setTimeout(() => {
    notification.classList.remove('show');
  }, 3000);
}

// ========== INICIALIZAÇÃO ==========

// Inicialização
document.addEventListener('DOMContentLoaded', function() {
  // Esconder loading overlays
  ['loading1', 'loading2', 'loading3'].forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.style.display = 'none';
    }
  });
  
  // Inicializar a API do Google
  setTimeout(() => {
    initGoogleAPI().then(() => {
      console.log('Google API inicializada com sucesso');
    }).catch(error => {
      console.error('Erro ao inicializar Google API:', error);
    });
  }, 1000);
  
  console.log('Sistema de registros fotográficos carregado');
  console.log('Sistema de textos para cópia carregado');
});