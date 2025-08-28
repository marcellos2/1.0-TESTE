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
const GOOGLE_CLIENT_ID = '413639391505-ju79cikoccl8n4ke361ibv0dtd9q4iji.apps.googleusercontent.com';
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/photoslibrary.readonly';
const DISCOVERY_DOCS = ['https://photoslibrary.googleapis.com/$discovery/rest?version=v1'];

// Estado da autenticação
let isGoogleApiLoaded = false;
let isUserSignedIn = false;
let gapi_ready = false;

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
    if (!window.gapi) {
      reject(new Error('Google API não carregada'));
      return;
    }

    gapi.load('auth2:client', async () => {
      try {
        await gapi.client.init({
          apiKey: GOOGLE_API_KEY,
          clientId: GOOGLE_CLIENT_ID,
          discoveryDocs: DISCOVERY_DOCS,
          scope: GOOGLE_SCOPES
        });

        const authInstance = gapi.auth2.getAuthInstance();
        isUserSignedIn = authInstance.isSignedIn.get();
        
        updateAuthButton();
        isGoogleApiLoaded = true;
        
        console.log('Google API inicializada com sucesso');
        resolve();
      } catch (error) {
        console.error('Erro ao inicializar Google API:', error);
        updateStatusMessage('Erro ao conectar com Google', 'error');
        reject(error);
      }
    });
  });
}

// Atualiza o botão de autenticação
function updateAuthButton() {
  const statusText = document.getElementById('statusText');
  const authButton = document.getElementById('authButton');
  const googleStatus = document.getElementById('googleStatus');
  
  if (isUserSignedIn) {
    statusText.textContent = '✅ Google Fotos conectado';
    authButton.style.display = 'none';
    googleStatus.className = 'google-status connected';
  } else {
    statusText.textContent = '⚠️ Google Fotos desconectado';
    authButton.style.display = 'inline-block';
    googleStatus.className = 'google-status disconnected';
  }
}

// Atualiza mensagem de status
function updateStatusMessage(message, type = 'info') {
  const statusText = document.getElementById('statusText');
  const googleStatus = document.getElementById('googleStatus');
  
  statusText.textContent = message;
  googleStatus.className = `google-status ${type}`;
}

// Manipula o clique no botão de autenticação
async function handleAuthClick() {
  try {
    if (!isGoogleApiLoaded) {
      await initGoogleAPI();
    }
    
    const authInstance = gapi.auth2.getAuthInstance();
    await authInstance.signIn();
    
    isUserSignedIn = true;
    updateAuthButton();
  } catch (error) {
    console.error('Erro na autenticação:', error);
    updateStatusMessage('Erro na autenticação', 'error');
  }
}

// Abre o seletor do Google Fotos
async function triggerGooglePhotos(photoNumber) {
  try {
    // Verifica se a API está carregada e o usuário autenticado
    if (!isGoogleApiLoaded) {
      await initGoogleAPI();
    }
    
    if (!isUserSignedIn) {
      await handleAuthClick();
      return;
    }

    // Busca fotos recentes do usuário
    const photos = await getRecentPhotos();
    
    if (photos.length === 0) {
      alert('Nenhuma foto encontrada no Google Fotos.');
      return;
    }

    // Mostra modal com seleção de fotos
    showPhotoSelector(photos, photoNumber);
    
  } catch (error) {
    console.error('Erro ao acessar Google Fotos:', error);
    alert('Erro ao acessar Google Fotos. Tente novamente.');
  }
}

// Busca fotos recentes do Google Fotos
async function getRecentPhotos(pageSize = 20) {
  try {
    const response = await gapi.client.photoslibrary.mediaItems.list({
      pageSize: pageSize,
      filters: {
        mediaTypeFilter: {
          mediaTypes: ['PHOTO']
        }
      }
    });
    
    return response.result.mediaItems || [];
  } catch (error) {
    console.error('Erro ao buscar fotos:', error);
    return [];
  }
}

// Mostra modal com seleção de fotos
function showPhotoSelector(photos, photoNumber) {
  // Remove modal existente se houver
  const existingModal = document.getElementById('photoModal');
  if (existingModal) {
    existingModal.remove();
  }

  // Cria modal
  const modal = document.createElement('div');
  modal.id = 'photoModal';
  modal.className = 'photo-modal';
  
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Selecione uma foto do Google Fotos</h3>
        <button class="close-modal" onclick="closePhotoModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="photo-grid" id="photoGrid">
          ${photos.map((photo, index) => `
            <div class="photo-item" onclick="selectGooglePhoto('${photo.id}', ${photoNumber})">
              <img src="${photo.baseUrl}=w200-h200-c" alt="Foto ${index + 1}">
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  modal.style.display = 'flex';
}

// Fecha modal de seleção
function closePhotoModal() {
  const modal = document.getElementById('photoModal');
  if (modal) {
    modal.remove();
  }
}

// Seleciona foto do Google
async function selectGooglePhoto(photoId, photoNumber) {
  try {
    closePhotoModal();
    
    const targetPhotoId = `photo${photoNumber}`;
    showLoading(targetPhotoId);
    
    // Obtém a foto em alta resolução
    const response = await gapi.client.photoslibrary.mediaItems.get({
      mediaItemId: photoId
    });
    
    const mediaItem = response.result;
    const highResUrl = `${mediaItem.baseUrl}=w1600-h1200`;
    
    // Carrega a imagem no elemento
    const imgElement = document.getElementById(targetPhotoId);
    
    // Aguarda o carregamento da imagem
    await new Promise((resolve, reject) => {
      imgElement.onload = resolve;
      imgElement.onerror = reject;
      imgElement.src = highResUrl;
    });
    
    // Reseta rotação
    photoRotations[targetPhotoId] = 0;
    
    console.log(`Foto carregada do Google: ${targetPhotoId}`);
    
  } catch (error) {
    console.error('Erro ao carregar foto do Google:', error);
    alert('Erro ao carregar a foto selecionada.');
  } finally {
    hideLoading(`photo${photoNumber}`);
  }
}

// ========== FUNÇÕES ORIGINAIS ==========

// Carrega as fotos nos respectivos blocos (arquivo local)
async function loadPhoto(input, photoId) {
  if (!input.files || !input.files.length) return;
  
  const file = input.files[0];
  const reader = new FileReader();
  
  reader.onload = async (e) => {
    const imgElement = document.getElementById(photoId);
    imgElement.src = e.target.result;
    
    // Resetar a rotação ao carregar uma nova foto
    photoRotations[photoId] = 0;
  };
  
  reader.readAsDataURL(file);
}

// Abre o input de upload
function triggerUpload(num) {
  document.getElementById(`upload${num}`).click();
}

// Rotação manual em 90 graus
function rotatePhoto(photoId) {
  const imgElement = document.getElementById(photoId);
  const currentSrc = imgElement.src;

  if (!currentSrc || (!currentSrc.startsWith('data:') && !currentSrc.includes('googleusercontent'))) {
    console.warn('Nenhuma imagem para girar em ' + photoId);
    return;
  }

  photoRotations[photoId] = (photoRotations[photoId] + 90) % 360;
  const rotationAngle = photoRotations[photoId];

  const tempImg = new Image();
  tempImg.crossOrigin = 'anonymous';
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
    logging: false,
    useCORS: true,
    allowTaint: true
  }).then(canvas => {
    const link = document.createElement('a');
    link.download = 'registro-fotografico.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
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
  
  // Inicializar a API do Google após um pequeno delay
  setTimeout(() => {
    initGoogleAPI().then(() => {
      console.log('Google API inicializada com sucesso');
    }).catch(error => {
      console.error('Erro ao inicializar Google API:', error);
      updateStatusMessage('Erro ao conectar com Google', 'error');
    });
  }, 1000);
  
  console.log('Sistema de registros fotográficos carregado');
  console.log('Sistema de textos para cópia carregado');
});