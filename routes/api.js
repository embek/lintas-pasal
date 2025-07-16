const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Import models
const { LegalDocument, DocumentManager } = require('../models');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '..', 'uploads', 'pdfs');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const timestamp = new Date().toISOString().slice(0,10).replace(/-/g,'');
    const randId = Math.random().toString(36).substring(2, 8);
    const cleanName = path.basename(file.originalname, path.extname(file.originalname))
               .substring(0, 25)
               .replace(/\s+/g, '_');
    const filename = `${timestamp}-${randId}-${cleanName}${path.extname(file.originalname)}`;
    cb(null, filename);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

// Initialize models
const legalDocument = new LegalDocument();
const documentManager = new DocumentManager();

// API Routes
router.get('/', (req, res) => {
  res.json({ 
    message: 'PDF API Ready',
    version: '2.0.0',
    mvc: true 
  });
});

// Upload and process PDF
router.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Tidak ada file yang diupload'
      });
    }

    // Extract text and parse to JSON using model
    const extractResult = await legalDocument.extractTextFromPdf(req.file.path);
    
    // Save results using model
    const saveResult = await legalDocument.saveExtractionResults(req.file.filename, extractResult);

    res.json({
      success: true,
      message: 'File PDF berhasil diupload dan diproses ke format JSON',
      data: {
        originalName: req.file.originalname,
        filename: req.file.filename,
        size: req.file.size,
        textLength: extractResult.textLength,
        numPages: extractResult.numPages,
        rawTextLength: extractResult.rawTextLength,
        uploadDate: new Date(),
        structure: extractResult.stats
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memproses file',
      error: error.message
    });
  }
});

// Get list of files
router.get('/files', async (req, res) => {
  try {
    const fileList = await documentManager.getFileList();
    const summary = documentManager.getFileListSummary(fileList);

    res.json({ 
      success: true, 
      files: fileList,
      summary: summary
    });
  } catch (error) {
    console.error('File list error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil daftar file',
      error: error.message
    });
  }
});

// Download PDF file
router.get('/download/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    
    if (!documentManager.fileExists(filename)) {
      return res.status(404).render('error', {
        error: {
          status: 404,
          message: 'File tidak ditemukan'
        }
      });
    }
    
    const filePath = documentManager.getFilePath(filename);
    res.download(filePath, filename);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).render('error', {
      error: {
        status: 500,
        message: 'Terjadi kesalahan saat mengunduh file'
      }
    });
  }
});

// View parsed content using hasil.ejs template
router.get('/view/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    
    // Get JSON content using model
    const result = await documentManager.getJsonContent(filename);
    
    if (!result.success) {
      return res.render('error', {
        error: {
          status: 404,
          message: 'File hasil parsing JSON tidak ditemukan. Silakan upload ulang PDF untuk memproses ulang.'
        }
      });
    }

    let formattedContent;
    
    if (result.isValidJSON) {
      // Format JSON for display using model
      formattedContent = LegalDocument.formatJSONForDisplay(result.data);
    } else {
      // Format plain text for display using model
      formattedContent = LegalDocument.formatPlainText(result.rawContent);
    }

    // Render using hasil.ejs template
    res.render('hasil', {
      filename: filename,
      formattedContent: formattedContent,
      rawContent: result.rawContent,
      isValidJSON: result.isValidJSON,
      stats: result.stats,
      fileSize: result.fileSize,
      parseTime: new Date().toLocaleString('id-ID')
    });

  } catch (error) {
    console.error('View error:', error);
    res.render('error', {
      error: {
        status: 500,
        message: 'Terjadi kesalahan saat memproses file: ' + error.message
      }
    });
  }
});

// Get JSON data directly (API endpoint)
router.get('/json/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const result = await documentManager.getJsonContent(filename);
    
    if (!result.success) {
      return res.status(404).json({
        success: false,
        message: 'File JSON tidak ditemukan'
      });
    }

    res.json({
      success: true,
      data: result.data,
      stats: result.stats,
      fileSize: result.fileSize,
      isValidJSON: result.isValidJSON
    });
  } catch (error) {
    console.error('JSON endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data JSON',
      error: error.message
    });
  }
});

// Search in JSON content
router.get('/search/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const { q: searchTerm, caseSensitive, exactMatch, searchInTitles, searchInContent } = req.query;
    
    if (!searchTerm) {
      return res.status(400).json({
        success: false,
        message: 'Parameter pencarian (q) diperlukan'
      });
    }

    const result = await documentManager.getJsonContent(filename);
    
    if (!result.success || !result.isValidJSON) {
      return res.status(404).json({
        success: false,
        message: 'File JSON tidak ditemukan atau tidak valid'
      });
    }

    // Search using model
    const searchResults = DocumentManager.searchInJSON(result.data, searchTerm, {
      caseSensitive: caseSensitive === 'true',
      exactMatch: exactMatch === 'true',
      searchInTitles: searchInTitles !== 'false',
      searchInContent: searchInContent !== 'false'
    });

    res.json({
      success: true,
      searchTerm: searchTerm,
      results: searchResults,
      totalResults: searchResults.length
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat melakukan pencarian',
      error: error.message
    });
  }
});

// Delete file
router.delete('/delete/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    
    if (!documentManager.fileExists(filename)) {
      return res.status(404).json({
        success: false,
        message: 'File tidak ditemukan'
      });
    }

    await documentManager.deleteFiles(filename);

    res.json({
      success: true,
      message: 'File berhasil dihapus'
    });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menghapus file',
      error: error.message
    });
  }
});

// Filter JSON content
router.get('/filter/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const { babNumbers, bagianNumbers, pasalNumbers } = req.query;
    
    const result = await documentManager.getJsonContent(filename);
    
    if (!result.success || !result.isValidJSON) {
      return res.status(404).json({
        success: false,
        message: 'File JSON tidak ditemukan atau tidak valid'
      });
    }

    // Parse filter parameters
    const filters = {
      babNumbers: babNumbers ? babNumbers.split(',').map(num => parseInt(num)) : [],
      bagianNumbers: bagianNumbers ? bagianNumbers.split(',').map(num => parseInt(num)) : [],
      pasalNumbers: pasalNumbers ? pasalNumbers.split(',').map(num => parseInt(num)) : []
    };

    // Filter using model
    const filteredData = DocumentManager.filterJSON(result.data, filters);
    const filteredStats = DocumentManager.getFilteredStats(filteredData);

    res.json({
      success: true,
      data: filteredData,
      stats: filteredStats,
      filters: filters
    });
  } catch (error) {
    console.error('Filter error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat memfilter data',
      error: error.message
    });
  }
});

module.exports = router;
