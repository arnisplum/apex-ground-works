const services = {
  excavation: {
    title: 'Excavation',
    image: 'media/images/web/IMG_2832.webp',
    text: 'Careful excavation for residential, commercial and civil site conditions, from access-sensitive digging to full site preparation.',
    list: ['Site preparation and bulk excavation', 'Trenching and utility access', 'Grading and earthworks', 'Foundation and landscape excavation']
  },
  civil: {
    title: 'Civil Works & Utilities',
    image: 'media/images/web/IMG_3155.webp',
    text: 'Coordinated civil groundwork for sewer, utilities, conduit, service connections and site infrastructure.',
    list: ['Sewer and service trenches', 'Utility and conduit runs', 'Civil connections and prep', 'Coordination with builders and trades']
  },
  drainage: {
    title: 'Drainage',
    image: 'media/images/web/IMG_3034.webp',
    text: 'Drainage systems designed to move water properly and protect structures, landscapes and finished site work.',
    list: ['Perimeter and drain tile systems', 'Trenching and gravel bedding', 'Water management corrections', 'Backfill and site restoration']
  },
  dampproofing: {
    title: 'Dampproofing',
    image: 'media/images/web/IMG_3160.webp',
    text: 'Foundation exposure and site preparation for dampproofing, waterproofing and exterior foundation protection.',
    list: ['Foundation excavation and exposure', 'Wall preparation and access', 'Drainage coordination', 'Controlled backfill and grading']
  },
  'sump-septic': {
    title: 'Sumps & Septic',
    image: 'media/images/web/IMG_8520.webp',
    text: 'Groundwork and excavation support for sump systems, tanks, fields and related site drainage.',
    list: ['Sump excavation and placement prep', 'Tank excavation and bedding', 'Septic field groundwork', 'Drainage and final grading']
  },
  hardscaping: {
    title: 'Hardscaping',
    image: 'media/images/web/IMG_1209.webp',
    text: 'Groundwork for retaining walls, landscape structures, stone work and durable exterior site finishes.',
    list: ['Retaining wall excavation', 'Base preparation and compaction', 'Landscape and grade preparation', 'Stone and exterior site finishing']
  }
};

const galleries = {
  residential: {
    title: 'Residential excavation', subtitle: 'Lower Mainland, BC',
    images: ['IMG_2836.webp','IMG_2835.webp','IMG_2832.webp','IMG_2872.webp','IMG_2873.webp']
  },
  drainage: {
    title: 'Drainage & trenching', subtitle: 'Site infrastructure',
    images: ['IMG_3034.webp','IMG_3021.webp','IMG_3155.webp','IMG_3160.webp']
  },
  retaining: {
    title: 'Retaining groundwork', subtitle: 'Residential site work',
    images: ['IMG_1209.webp','IMG_0805.webp','IMG_2882.webp']
  },
  'tight-access': {
    title: 'Tight-access excavation', subtitle: 'Residential',
    images: ['IMG_2832.webp','IMG_2872.webp','IMG_2876.webp','IMG_2942.webp']
  },
  'site-prep': {
    title: 'Site preparation', subtitle: 'Builder support',
    images: ['IMG_3155.webp','IMG_3160.webp','IMG_2944.webp','IMG_3021.webp']
  }
};

const serviceModal = document.getElementById('service-modal');
const serviceTitle = document.getElementById('service-modal-title');
const serviceText = document.getElementById('service-modal-text');
const serviceImage = document.getElementById('service-modal-image');
const serviceList = document.getElementById('service-modal-list');

function openService(key) {
  const item = services[key]; if (!item) return;
  serviceTitle.textContent = item.title;
  serviceText.textContent = item.text;
  serviceImage.src = item.image;
  serviceImage.alt = `${item.title} project`;
  serviceList.innerHTML = item.list.map(v => `<li>${v}</li>`).join('');
  serviceModal.classList.add('is-open');
  serviceModal.setAttribute('aria-hidden','false');
  document.body.classList.add('modal-open');
}
function closeService(){serviceModal.classList.remove('is-open');serviceModal.setAttribute('aria-hidden','true');document.body.classList.remove('modal-open');}

document.querySelectorAll('[data-service]').forEach(el => el.addEventListener('click',()=>openService(el.dataset.service)));
document.querySelectorAll('[data-close-modal]').forEach(el => el.addEventListener('click',closeService));

const galleryModal = document.getElementById('gallery-modal');
const galleryImage = document.getElementById('gallery-image');
const galleryTitle = document.getElementById('gallery-title');
const gallerySubtitle = document.getElementById('gallery-subtitle');
const galleryCount = document.getElementById('gallery-count');
const galleryThumbs = document.getElementById('gallery-thumbs');
let currentGallery = null;
let currentIndex = 0;

function imagePath(name){ return `media/images/web/${name}`; }
function renderGallery(){
  const item = galleries[currentGallery]; if (!item) return;
  const name = item.images[currentIndex];
  galleryImage.src = imagePath(name);
  galleryImage.alt = item.title;
  galleryTitle.textContent = item.title;
  gallerySubtitle.textContent = item.subtitle;
  galleryCount.textContent = `${String(currentIndex+1).padStart(2,'0')} / ${String(item.images.length).padStart(2,'0')}`;
  galleryThumbs.innerHTML = item.images.map((img,i)=>`<button type="button" class="gallery-thumb ${i===currentIndex?'is-active':''}" data-index="${i}" aria-label="View image ${i+1}"><img src="${imagePath(img)}" alt="" /></button>`).join('');
  galleryThumbs.querySelectorAll('[data-index]').forEach(btn=>btn.addEventListener('click',()=>{currentIndex=Number(btn.dataset.index);renderGallery();}));
}
function openGallery(key){ currentGallery=key; currentIndex=0; renderGallery(); galleryModal.classList.add('is-open'); galleryModal.setAttribute('aria-hidden','false'); document.body.classList.add('modal-open'); }
function closeGallery(){ galleryModal.classList.remove('is-open'); galleryModal.setAttribute('aria-hidden','true'); document.body.classList.remove('modal-open'); }
function stepGallery(dir){ const item=galleries[currentGallery]; if(!item) return; currentIndex=(currentIndex+dir+item.images.length)%item.images.length; renderGallery(); }

document.querySelectorAll('[data-project]').forEach(el=>{
  el.addEventListener('click',()=>openGallery(el.dataset.project));
  el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openGallery(el.dataset.project);}});
});
document.querySelectorAll('[data-close-gallery]').forEach(el=>el.addEventListener('click',closeGallery));
document.querySelector('.gallery-arrow.prev')?.addEventListener('click',()=>stepGallery(-1));
document.querySelector('.gallery-arrow.next')?.addEventListener('click',()=>stepGallery(1));

document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){closeService();closeGallery();}
  if(galleryModal.classList.contains('is-open') && e.key==='ArrowLeft') stepGallery(-1);
  if(galleryModal.classList.contains('is-open') && e.key==='ArrowRight') stepGallery(1);
});
