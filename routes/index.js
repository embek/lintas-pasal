var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Lintas Pasal' });
});

/* GET test upload page. */
router.get('/test', function(req, res, next) {
  res.render('test', { 
    title: 'Test Upload PDF - Lintas Pasal',
    pageTitle: 'Test Upload PDF',
    description: 'Halaman untuk testing upload dan manajemen file PDF'
  });
});

module.exports = router;
