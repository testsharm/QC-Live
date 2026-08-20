/* ============================================================
   Dangerous Mountain Bus Drive — autonomous, self-playing scene
   No user input. Loops forever. Built for vertical (1080x1920)
   capture and live streaming.
   ============================================================ */

(function () {
  "use strict";

  var CANVAS_WIDTH = 1080;
  var CANVAS_HEIGHT = 1920;
  var TARGET_FPS = 30;
  var LAP_DURATION_SECONDS = 90;   // time to complete one full loop of the road
  var CAMERA_SWITCH_SECONDS = 8;   // how often the camera view alternates
  var ROAD_HALF_WIDTH = 6;

  var canvas = document.getElementById("gameCanvas");

  var renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance"
  });
  renderer.setPixelRatio(1);
  renderer.setSize(CANVAS_WIDTH, CANVAS_HEIGHT, false);
  renderer.setClearColor(0x05060a, 1);

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060a);
  scene.fog = new THREE.FogExp2(0x0a0e1a, 0.028);

  var camera = new THREE.PerspectiveCamera(
    55,
    CANVAS_WIDTH / CANVAS_HEIGHT,
    0.1,
    2000
  );

  /* ---------------- Lighting ---------------- */

  var ambientLight = new THREE.AmbientLight(0x1a2035, 0.65);
  scene.add(ambientLight);

  var moonLight = new THREE.DirectionalLight(0x8fa8ff, 0.55);
  moonLight.position.set(-120, 180, -80);
  scene.add(moonLight);

  var fillLight = new THREE.HemisphereLight(0x334466, 0x05060a, 0.35);
  scene.add(fillLight);

  var headlightLeft = new THREE.SpotLight(0xfff3d0, 1.6, 90, Math.PI / 7, 0.5, 1.2);
  var headlightRight = new THREE.SpotLight(0xfff3d0, 1.6, 90, Math.PI / 7, 0.5, 1.2);
  scene.add(headlightLeft, headlightLeft.target);
  scene.add(headlightRight, headlightRight.target);

  /* ---------------- Mountain road path ---------------- */

  var roadPoints = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(45, 6, -55),
    new THREE.Vector3(95, 16, -35),
    new THREE.Vector3(115, 28, 25),
    new THREE.Vector3(70, 38, 85),
    new THREE.Vector3(5, 46, 115),
    new THREE.Vector3(-65, 50, 90),
    new THREE.Vector3(-115, 40, 25),
    new THREE.Vector3(-100, 24, -40),
    new THREE.Vector3(-50, 10, -85)
  ];

  var roadCurve = new THREE.CatmullRomCurve3(roadPoints, true, "catmullrom", 0.5);

  function buildRoadGeometry(curve, segments, halfWidth) {
    var positions = [];
    var uvs = [];
    var indices = [];
    var up = new THREE.Vector3(0, 1, 0);

    for (var i = 0; i <= segments; i++) {
      var t = (i / segments) % 1;
      var point = curve.getPointAt(t);
      var tangent = curve.getTangentAt(t).normalize();
      var right = new THREE.Vector3().crossVectors(tangent, up).normalize();
      if (right.lengthSq() < 0.0001) right.set(1, 0, 0);

      var left = point.clone().addScaledVector(right, -halfWidth);
      var rightP = point.clone().addScaledVector(right, halfWidth);

      positions.push(left.x, left.y + 0.02, left.z);
      positions.push(rightP.x, rightP.y + 0.02, rightP.z);

      var v = (i / segments) * 40;
      uvs.push(0, v, 1, v);
    }

    for (var s = 0; s < segments; s++) {
      var a = s * 2, b = s * 2 + 1, c = s * 2 + 2, d = s * 2 + 3;
      indices.push(a, b, c, b, d, c);
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  var roadGeo = buildRoadGeometry(roadCurve, 300, ROAD_HALF_WIDTH);
  var roadMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a2e,
    roughness: 0.95,
    metalness: 0.05,
    side: THREE.DoubleSide
  });
  var roadMesh = new THREE.Mesh(roadGeo, roadMat);
  scene.add(roadMesh);

  // Centre line markers (danger-road stripe)
  var centreGeo = buildRoadGeometry(roadCurve, 300, 0.15);
  var centreMat = new THREE.MeshBasicMaterial({ color: 0xffcc33 });
  var centreLine = new THREE.Mesh(centreGeo, centreMat);
  centreLine.position.y = 0.03;
  scene.add(centreLine);

  // Cliff-edge marker lights along one side of the road
  var edgeLightGeo = new THREE.SphereGeometry(0.35, 8, 8);
  var edgeLightMat = new THREE.MeshBasicMaterial({ color: 0xff5533 });
  var edgeGroup = new THREE.Group();
  var EDGE_LIGHT_COUNT = 90;
  for (var e = 0; e < EDGE_LIGHT_COUNT; e++) {
    var et = e / EDGE_LIGHT_COUNT;
    var ep = roadCurve.getPointAt(et);
    var etan = roadCurve.getTangentAt(et).normalize();
    var eright = new THREE.Vector3().crossVectors(etan, new THREE.Vector3(0, 1, 0)).normalize();
    var marker = new THREE.Mesh(edgeLightGeo, edgeLightMat);
    marker.position.copy(ep.clone().addScaledVector(eright, ROAD_HALF_WIDTH + 0.6));
    marker.position.y += 0.4;
    edgeGroup.add(marker);
  }
  scene.add(edgeGroup);

  /* ---------------- Terrain / mountains / valley ---------------- */

  var valleyGeo = new THREE.PlaneGeometry(3000, 3000, 1, 1);
  var valleyMat = new THREE.MeshStandardMaterial({ color: 0x02030a, roughness: 1 });
  var valleyMesh = new THREE.Mesh(valleyGeo, valleyMat);
  valleyMesh.rotation.x = -Math.PI / 2;
  valleyMesh.position.y = -55;
  scene.add(valleyMesh);

  function addMountain(x, z, height, radius, color) {
    var geo = new THREE.ConeGeometry(radius, height, 6);
    var mat = new THREE.MeshStandardMaterial({ color: color, roughness: 1, metalness: 0 });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, height / 2 - 10, z);
    mesh.rotation.y = Math.random() * Math.PI;
    scene.add(mesh);
  }

  var mountainColors = [0x11131c, 0x161a26, 0x0d0f16];
  for (var m = 0; m < 40; m++) {
    var angle = Math.random() * Math.PI * 2;
    var dist = 160 + Math.random() * 260;
    var mx = Math.cos(angle) * dist;
    var mz = Math.sin(angle) * dist;
    var mh = 60 + Math.random() * 140;
    var mr = 30 + Math.random() * 70;
    addMountain(mx, mz, mh, mr, mountainColors[m % mountainColors.length]);
  }

  /* ---------------- Bus ---------------- */

  var bus = new THREE.Group();

  var bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8442c, roughness: 0.55, metalness: 0.25 });
  var roofMat = new THREE.MeshStandardMaterial({ color: 0xb8371f, roughness: 0.6, metalness: 0.2 });
  var glassMat = new THREE.MeshStandardMaterial({ color: 0x0c1420, roughness: 0.2, metalness: 0.6 });
  var wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  var trimMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4, metalness: 0.3 });

  var body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 7.5), bodyMat);
  body.position.y = 1.4;
  bus.add(body);

  var roof = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.5, 7.2), roofMat);
  roof.position.y = 2.75;
  bus.add(roof);

  var windshield = new THREE.Mesh(new THREE.BoxGeometry(2.35, 1.3, 0.1), glassMat);
  windshield.position.set(0, 1.9, -3.72);
  bus.add(windshield);

  var sideWindowGeoLen = 5.2;
  var sideWindowL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.0, sideWindowGeoLen), glassMat);
  sideWindowL.position.set(1.31, 1.85, 0.2);
  bus.add(sideWindowL);
  var sideWindowR = sideWindowL.clone();
  sideWindowR.position.x = -1.31;
  bus.add(sideWindowR);

  var bumperFront = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.4, 0.3), trimMat);
  bumperFront.position.set(0, 0.5, -3.75);
  bus.add(bumperFront);

  function addWheel(x, z) {
    var wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.5, 16), wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.55, z);
    bus.add(wheel);
  }
  addWheel(1.4, -2.6);
  addWheel(-1.4, -2.6);
  addWheel(1.4, 2.6);
  addWheel(-1.4, 2.6);

  scene.add(bus);

  /* ---------------- Animation state ---------------- */

  var startTime = null;
  var lastFrameTime = 0;
  var frameInterval = 1000 / TARGET_FPS;
  var UP = new THREE.Vector3(0, 1, 0);
  var readySignalSet = false;

  function updateHeadlights(point, tangent, right) {
    var lx = point.clone().addScaledVector(right, 0.9).addScaledVector(tangent, -3.7);
    var rx = point.clone().addScaledVector(right, -0.9).addScaledVector(tangent, -3.7);
    lx.y += 0.8;
    rx.y += 0.8;
    headlightLeft.position.copy(lx);
    headlightRight.position.copy(rx);
    var aim = point.clone().addScaledVector(tangent, -20);
    aim.y += 0.2;
    headlightLeft.target.position.copy(aim);
    headlightRight.target.position.copy(aim);
  }

  function animate(now) {
    requestAnimationFrame(animate);

    if (startTime === null) startTime = now;
    if (now - lastFrameTime < frameInterval) return;
    lastFrameTime = now;

    var elapsed = (now - startTime) / 1000;
    var busT = (elapsed / LAP_DURATION_SECONDS) % 1;

    var point = roadCurve.getPointAt(busT);
    var tangent = roadCurve.getTangentAt(busT).normalize();
    var right = new THREE.Vector3().crossVectors(tangent, UP).normalize();
    if (right.lengthSq() < 0.0001) right.set(1, 0, 0);

    var wobble = Math.sin(elapsed * 0.55) * 1.2;
    var busPos = point.clone().addScaledVector(right, wobble);
    busPos.y += 1.05;

    bus.position.copy(busPos);
    bus.lookAt(busPos.clone().add(tangent));

    updateHeadlights(point, tangent, right);

    var cameraModeIndex = Math.floor(elapsed / CAMERA_SWITCH_SECONDS) % 2;

    if (cameraModeIndex === 0) {
      // Third-person follow cam
      if (camera.fov !== 52) {
        camera.fov = 52;
        camera.updateProjectionMatrix();
      }
      var followPos = point.clone()
        .addScaledVector(tangent, -13)
        .addScaledVector(UP, 6.5)
        .addScaledVector(right, wobble * 0.5);
      camera.position.copy(followPos);
      camera.lookAt(busPos.clone().addScaledVector(UP, 1.5));
    } else {
      // Driver bumper cam
      if (camera.fov !== 78) {
        camera.fov = 78;
        camera.updateProjectionMatrix();
      }
      var bumperPos = point.clone()
        .addScaledVector(tangent, 2.2)
        .addScaledVector(UP, 2.5)
        .addScaledVector(right, wobble);
      camera.position.copy(bumperPos);
      var lookT = (busT + 0.045) % 1;
      var lookPoint = roadCurve.getPointAt(lookT);
      camera.lookAt(lookPoint);
    }

    renderer.render(scene, camera);

    if (!readySignalSet) {
      window.__SCENE_READY__ = true;
      readySignalSet = true;
    }
  }

  window.__SCENE_READY__ = false;
  requestAnimationFrame(animate);
})();
