'use strict';

function launch(req, res) {
  res.set('Cache-Control', 'no-store');
  if (req.session && req.session.kioskMode) {
    return res.redirect(302, '/kiosk');
  }
  if (!req.session || !req.session.userId) {
    return res.redirect(302, '/login.html');
  }
  const role = req.session.role;
  if (role === 'admin' || role === 'staff') {
    return res.redirect(302, '/pages/admin/dashboard.html');
  }
  return res.redirect(302, '/pages/volunteer/dashboard.html');
}

module.exports = { launch };
