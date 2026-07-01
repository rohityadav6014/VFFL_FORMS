// --- Smooth Scrolling (Lenis) ---
const lenis = new Lenis({
    duration: 1.2,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smooth: true,
});

function raf(time) {
    lenis.raf(time);
    requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

// --- Three.js Background (Floating Mesh & Particles) ---
const canvasContainer = document.getElementById('webgl-container');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
canvasContainer.appendChild(renderer.domElement);

// Particles
const particlesGeometry = new THREE.BufferGeometry();
const particlesCount = 800;
const posArray = new Float32Array(particlesCount * 3);

for(let i = 0; i < particlesCount * 3; i++) {
    posArray[i] = (Math.random() - 0.5) * 15;
}

particlesGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
const particlesMaterial = new THREE.PointsMaterial({
    size: 0.02,
    color: 0xfc6076,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending
});

const particlesMesh = new THREE.Points(particlesGeometry, particlesMaterial);
scene.add(particlesMesh);

// Floating Mesh (TorusKnot or Icosahedron)
const meshGeometry = new THREE.IcosahedronGeometry(2, 1);
const meshMaterial = new THREE.MeshStandardMaterial({
    color: 0x111111,
    wireframe: true,
    transparent: true,
    opacity: 0.15
});
const floatingMesh = new THREE.Mesh(meshGeometry, meshMaterial);
scene.add(floatingMesh);

// Lights
const pointLight = new THREE.PointLight(0xfc6076, 2, 10);
pointLight.position.set(2, 2, 2);
scene.add(pointLight);
const pointLight2 = new THREE.PointLight(0xff9a44, 2, 10);
pointLight2.position.set(-2, -2, 2);
scene.add(pointLight2);

camera.position.z = 5;

// Mouse tracking for Parallax
let mouseX = 0;
let mouseY = 0;
let targetX = 0;
let targetY = 0;
const windowHalfX = window.innerWidth / 2;
const windowHalfY = window.innerHeight / 2;

document.addEventListener('mousemove', (event) => {
    mouseX = (event.clientX - windowHalfX);
    mouseY = (event.clientY - windowHalfY);
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();

function animate() {
    const elapsedTime = clock.getElapsedTime();

    targetX = mouseX * 0.001;
    targetY = mouseY * 0.001;

    particlesMesh.rotation.y += 0.0005;
    particlesMesh.rotation.x += 0.0002;
    
    floatingMesh.rotation.y += 0.002;
    floatingMesh.rotation.x += 0.001;
    
    // Parallax effect
    particlesMesh.position.x += (targetX - particlesMesh.position.x) * 0.05;
    particlesMesh.position.y += (-targetY - particlesMesh.position.y) * 0.05;
    
    floatingMesh.position.x += (targetX * 2 - floatingMesh.position.x) * 0.05;
    floatingMesh.position.y += (-targetY * 2 - floatingMesh.position.y) * 0.05;

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}
animate();

// --- GSAP & ScrollTrigger Animations ---
gsap.registerPlugin(ScrollTrigger);

lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((time) => {
  lenis.raf(time * 1000);
});
gsap.ticker.lagSmoothing(0);

// Logo 360 Rotation on Scroll
gsap.to('.logo-3d', {
    rotationY: 360,
    ease: "none",
    scrollTrigger: {
        trigger: "body",
        start: "top top",
        end: "bottom bottom",
        scrub: 1
    }
});

// Initial Reveal
const tl = gsap.timeline();
tl.from('.nav-logo, .nav-links a', {
    y: -20,
    duration: 1,
    stagger: 0.1,
    ease: 'power3.out'
})
.from('.hero .line', {
    y: 100,
    opacity: 0,
    duration: 1.2,
    stagger: 0.2,
    ease: 'power4.out'
}, "-=0.8")
.from('.logo-3d', {
    scale: 0.8,
    opacity: 0,
    duration: 1.5,
    ease: 'power3.out'
}, "-=1")
.from('.subtitle', {
    y: 20,
    opacity: 0,
    duration: 1,
    ease: 'power2.out'
}, "-=1");

// Text block reveal
gsap.utils.toArray('.split-text').forEach(element => {
    gsap.from(element.children, {
        scrollTrigger: {
            trigger: element,
            start: "top 80%",
        },
        y: 50,
        opacity: 0,
        duration: 1,
        stagger: 0.2,
        ease: 'power3.out'
    });
});

// Glass card reveal
gsap.from('.glass-card', {
    scrollTrigger: {
        trigger: '.editorial-section',
        start: "top 70%",
    },
    x: 100,
    opacity: 0,
    duration: 1.2,
    ease: 'power3.out'
});

// Services reveal
gsap.utils.toArray('.service-item').forEach((item, i) => {
    gsap.from(item, {
        scrollTrigger: {
            trigger: item,
            start: "top 85%"
        },
        y: 100,
        opacity: 0,
        duration: 1,
        ease: 'power3.out'
    });
});

// Scroll text background
gsap.to('.scroll-text', {
    scrollTrigger: {
        trigger: '.services-section',
        start: "top bottom",
        end: "bottom top",
        scrub: 1
    },
    x: "-30vw",
    ease: "none"
});

// --- Mouse Follow for Logo (Desktop) ---
// Disabled to prevent conflicts with ScrollTrigger rotation.
/*
const logo3D = document.querySelector('.logo-3d');
const logoWrapper = document.querySelector('.logo-wrapper');

logoWrapper.addEventListener('mousemove', (e) => {
    const rect = logoWrapper.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const centerY = rect.height / 2;
    const rotateX = ((y - centerY) / centerY) * -20;
    
    // Only apply X rotation, let GSAP handle Y rotation via inline styles
    gsap.to(logo3D, { rotationX: rotateX, duration: 0.5, ease: "power2.out", overwrite: "auto" });
});

logoWrapper.addEventListener('mouseleave', () => {
    gsap.to(logo3D, { rotationX: 0, duration: 0.5, ease: "power2.out", overwrite: "auto" });
});
*/
