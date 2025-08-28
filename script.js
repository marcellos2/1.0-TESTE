// Armazena a rotação de cada imagem em graus
const photoRotations = {
  photo1: 0,
  photo2: 0,
  photo3: 0,
};

// Cache do Tesseract worker para melhor performance
let tesseractWorker = null;

// Configurações da API do Google
const GOOGLE_API_KEY = 'AIzaSyAQorqgDbL8SkEEKbxArrkUrW90Bo3HElA';
const GOOGLE_CLIENT_ID = '413639391505-ju79cikoccl8n4ke361ibv0dtd9q4iji.apps.googleusercontent.com';
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
      tessedit_char_whitelist:
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ÀÁÂÃÇÉÊÍÓÔÕÚàáâãçéêíóôõú ',
    });
  }
  return tesseractWorker;
}

// ========== INTEGRAÇÃO COM GOOGLE FOTOS ==========

// Inicializa a API do Google
function initGoogleAPI() {
  return new Promise((resolve, reject) => {
    gapi.load('client:auth2', () => {
      gapi.client
        .init({
          apiKey: GOOGLE_API_KEY,
          clientId: GOOGLE_CLIENT_ID,
          discoveryDocs: [
            'https://photoslibrary.googleapis.com/$discovery/rest?version=v1',
          ],
          scope: GOOGLE_SCOPES,
        })
        .then(() => {
          console.log('Google API inicializada');
          resolve();
        })
        .catch(error => {
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

    // Cria e abre o seletor do Google Fotos (correção do erro: falta o ponto antes do setOAuthToken)
    const googlePhotosPicker = new google.picker.PickerBuilder()
      .addView(google.picker.ViewId.PHOTOS)
      .addView(google.picker.ViewId.PHOTO_ALBUMS)
      .addView(google.picker.ViewId.PHOTO_UPLOAD)
      .setOAuthToken(
        gapi.auth2
          .getAuthInstance()
          .currentUser.get()
          .getAuthResponse().access_token
      )
      .setDeveloperKey(GOOGLE_API_KEY)
      .setCallback(data => {
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
      mediaItemId: photoId,
    });

    const mediaItem = response.result;
    const photoUrl = `${mediaItem.baseUrl}=w1600-h1200`; // Tamanho ajustável

    // Define a imagem no elemento <img>
    const imgElement = document.getElementById(targetPhotoId);
    imgElement.src = photoUrl;

    // Restaura rotação para 0
    photoRotations[targetPhotoId] = 0;

    // Verifica se a rotação automática está habilitada
    const autoRotateEnabled = document.getElementById('autoRotateToggle');
    if (autoRotateEnabled && autoRotateEnabled.checked) {
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

// ========== DETECÇÃO E ROTAÇÃO AUTOMÁTICA ==========

// Detecta a orientação do texto e rotaciona automaticamente (versão otimizada)
async function detectAndRotateImage(photoId, imageSrc) {
  try {
    showLoading(photoId);
    showProcessingStatus('Analisando orientação da imagem...');

    // Reduz a imagem para análise mais rápida
    const resizedImage = await resizeImageForAnalysis(imageSrc, 400);

    // Teste rápido (0° e 180°)
    const quickTest = await quickOrientationTest(resizedImage);

    if (quickTest.confidence > 0.7) {
      // Se a confiança for alta, usa esse resultado
      if (quickTest.angle !== 0) {
        await applyRotation(photoId, imageSrc, quickTest.angle);
      }
    } else {
      // Se a confiança for baixa, fazer um teste completo (0°, 90°, 180°, 270°)
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
    const confidence = await analyzeTextOrientation(rotatedImage, true);
    results.push({ angle, confidence });
  }

  return results.reduce((prev, current) =>
    prev.confidence > current.confidence ? prev : current
  );
}

// Teste completo de orientação (0°, 90°, 180°, 270°)
async function fullOrientationTest(imageSrc) {
  const angles = [0, 90, 180, 270];
  const results = [];

  for (let angle of angles) {
    const rotatedImage = await rotateImageForAnalysis(imageSrc, angle);
    const confidence = await analyzeTextOrientation(rotatedImage, false);
    results.push({ angle, confidence });
  }

  return results.reduce((prev, current) =>
    prev.confidence > current.confidence ? prev : current
  );
}

// Redimensiona a imagem para análise mais rápida
function resizeImageForAnalysis(imageSrc, maxWidth) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const ratio = Math.min(
        maxWidth / img.naturalWidth,
        maxWidth / img.naturalHeight
      );
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
    console.log(`Rotação aplicada: ${angle}° em ${photoId}`);
  }
}

// Rotaciona uma imagem em memória (para análise ou aplicação)
function rotateImageForAnalysis(imageSrc, angle) {
  return new Promise(resolve => {
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
      ctx.rotate((angle * Math.PI) / 180);
      ctx.drawImage(
        tempImg,
        -tempImg.naturalWidth / 2,
        -tempImg.naturalHeight / 2
      );

      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    tempImg.src = imageSrc;
  });
}

// Analisa a orientação do texto usando OCR
async function analyzeTextOrientation(imageSrc, fastMode = false) {
  try {
    const worker = await initTesseractWorker();
    const options = {
      tessedit_pageseg_mode: fastMode
        ? Tesseract.PSM.SINGLE_BLOCK
        : Tesseract.PSM.AUTO,
    };

    const {
      data: { text, confidence },
    } = await worker.recognize(imageSrc, options);

    // Heurísticas para pontuar a legibilidade do texto
    const textLength = text.trim().length;
    const wordCount = text.trim().split(/\s+/).filter(w => w.length > 2).length;
    const hasReadableWords = /[a-zA-ZÀ-ÿ]{3,}/.test(text);

    let score = 0;
    // Baseado na confiança
    score += (confidence / 100) * 0.6;
    // Baseado no tamanho do texto
    score += Math.min(textLength / 30, 0.25);
    // Baseado no número de palavras
    score += Math.min(wordCount / 3, 0.15);
    // Bônus se há palavras legíveis
    if (hasReadableWords) {
      score += 0.2;
    }

    return Math.min(score, 1.0);
  } catch (error) {
    console.error('Erro na análise OCR:', error);
    return 0;
  }
}

// ========== ROTAÇÃO MANUAL ==========

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
    ctx.rotate((rotationAngle * Math.PI) / 180);
    ctx.drawImage(
      tempImg,
      -tempImg.naturalWidth / 2,
      -tempImg.naturalHeight / 2
    );

    imgElement.src = canvas.toDataURL('image/png');
  };
  tempImg.src = currentSrc;
}

// ========== SALVAR RELATÓRIO ==========

function saveReport() {
  html2canvas(document.querySelector('#captureArea'), {
    scale: 2,
    backgroundColor: '#ffffff',
    logging: false,
  }).then(canvas => {
    const link = document.createElement('a');
    link.download = 'registro-fotografico.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
}

// ========== CÓPIA DE TEXTOS ==========

function copyText(button, textId) {
  const textElement = document.getElementById(textId);
  const text = textElement.textContent.trim();

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        showCopySuccess(button);
      })
      .catch(() => {
        fallbackCopy(text, button);
      });
  } else {
    fallbackCopy(text, button);
  }
}

function fallbackCopy(text, button) {
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

function showCopySuccess(button) {
  const originalText = button.querySelector('.copy-text').textContent;
  button.classList.add('copied');
  button.querySelector('.copy-text').textContent = 'Copiado!';
  button.querySelector('.copy-icon').textContent = '✅';

  showNotification('✅ Texto copiado com sucesso!', 'success');

  setTimeout(() => {
    button.classList.remove('copied');
    button.querySelector('.copy-text').textContent = originalText;
    button.querySelector('.copy-icon').textContent = '📋';
  }, 2000);
}

function showCopyError() {
  showNotification('❌ Erro ao copiar texto. Tente novamente.', 'error');
}

function showNotification(message, type = 'success') {
  const notification = document.getElementById('copyNotification');
  notification.textContent = message;
  notification.className = 'copy-notification show';

  if (type === 'error') {
    notification.style.background = '#f44336';
  } else {
    notification.style.background = '#4CAF50';
  }

  setTimeout(() => {
    notification.classList.remove('show');
  }, 3000);
}

// ========== FUNÇÕES DE INTERFACE ==========

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

// ========== INICIALIZAÇÃO ==========

document.addEventListener('DOMContentLoaded', function() {
  // Esconder overlays de "carregando"
  ['loading1', 'loading2', 'loading3'].forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.style.display = 'none';
    }
  });

  // Inicializa a API do Google depois de um pequeno delay
  setTimeout(() => {
    initGoogleAPI()
      .then(() => {
        console.log('Google API inicializada com sucesso');
      })
      .catch(error => {
        console.error('Erro ao inicializar Google API:', error);
      });
  }, 1000);

  console.log('Sistema de registros fotográficos carregado');
  console.log('Sistema de textos para cópia carregado');
});