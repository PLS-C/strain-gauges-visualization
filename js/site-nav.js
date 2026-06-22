(function () {
  'use strict';

  var PAGES = [
    { href: 'index.html', label: 'Home' },
    { href: 'Strain and Stress.html', label: 'Strain and Stress (Bar)' },
    { href: 'Strain Gauge.html', label: 'Serpentine Strain Gauge' },
    { href: 'load_cells.html', label: 'Load Cell (Wheatstone Bridge)' },
    { href: 'load_cell_calibration.html', label: 'Load Cell Calibration' }
  ];

  function getCurrentPage() {
    var segment = window.location.pathname.split('/').pop();
    if (!segment || segment === '') {
      return 'index.html';
    }
    return decodeURIComponent(segment);
  }

  function renderSiteNav(mount) {
    var current = getCurrentPage();
    var nav = document.createElement('nav');
    nav.className = 'site-nav';
    nav.setAttribute('aria-label', 'Site navigation');

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'site-nav-toggle';
    toggle.setAttribute('aria-label', 'Open menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'site-nav-menu');

    for (var i = 0; i < 3; i++) {
      var bar = document.createElement('span');
      bar.className = 'site-nav-bar';
      bar.setAttribute('aria-hidden', 'true');
      toggle.appendChild(bar);
    }

    var menu = document.createElement('div');
    menu.id = 'site-nav-menu';
    menu.className = 'site-nav-menu';
    menu.hidden = true;

    var list = document.createElement('ul');
    list.className = 'site-nav-list';

    PAGES.forEach(function (page) {
      var item = document.createElement('li');
      var link = document.createElement('a');
      link.href = page.href;
      link.className = 'site-nav-link';
      link.textContent = page.label;

      if (page.href === current) {
        link.classList.add('is-active');
        link.setAttribute('aria-current', 'page');
      }

      item.appendChild(link);
      list.appendChild(item);
    });

    menu.appendChild(list);
    nav.appendChild(toggle);
    nav.appendChild(menu);
    mount.replaceWith(nav);

    function closeMenu() {
      nav.classList.remove('is-open');
      menu.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open menu');
    }

    function openMenu() {
      nav.classList.add('is-open');
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Close menu');
    }

    toggle.addEventListener('click', function () {
      if (menu.hidden) {
        openMenu();
      } else {
        closeMenu();
      }
    });

    document.addEventListener('click', function (e) {
      if (!nav.contains(e.target)) {
        closeMenu();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) {
        closeMenu();
        toggle.focus();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var mount = document.getElementById('site-nav');
    if (mount) {
      renderSiteNav(mount);
    }
  });
})();
