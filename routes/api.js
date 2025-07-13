var express = require('express');
var router = express.Router();
var multer = require('multer');
var path = require('path');
var fs = require('fs');

// Import pdfjs-dist untuk parsing PDF dengan layout preservation
var pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

var storage = multer.diskStorage({
  destination: (req, file, cb) => {
    var uploadPath = path.join(__dirname, '..', 'uploads', 'pdfs');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generate nama file unik dengan timestamp
    var uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    var filename = file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname);
    cb(null, filename);
  }
});

// Filter untuk hanya menerima file PDF
var fileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Hanya file PDF yang diperbolehkan!'), false);
  }
};

var upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // Maksimal 10MB
  }
});

// ====== PDF PARSING FUNCTIONS WITH LAYOUT PRESERVATION ======

// Enhanced PDF.js dengan layout preservation
async function extractWithLayoutPreservation(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const uint8Array = new Uint8Array(dataBuffer);
    
    const pdfDocument = await pdfjsLib.getDocument({
      data: uint8Array,
      useSystemFonts: true,
    }).promise;
    
    const numPages = pdfDocument.numPages;
    let fullText = '';
    let metadata = {
      title: '',
      author: '',
      subject: '',
      creator: '',
      producer: '',
      creationDate: '',
      modificationDate: '',
      numPages: numPages
    };

    // Extract metadata
    try {
      const metaData = await pdfDocument.getMetadata();
      if (metaData.info) {
        metadata.title = metaData.info.Title || '';
        metadata.author = metaData.info.Author || '';
        metadata.subject = metaData.info.Subject || '';
        metadata.creator = metaData.info.Creator || '';
        metadata.producer = metaData.info.Producer || '';
        metadata.creationDate = metaData.info.CreationDate || '';
        metadata.modificationDate = metaData.info.ModDate || '';
      }
    } catch (metaError) {
      console.warn('Could not extract metadata:', metaError.message);
    }
    
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      // Group text items by lines berdasarkan posisi Y
      const lines = {};
      textContent.items.forEach(item => {
        const y = Math.round(item.transform[5]); // Y position
        if (!lines[y]) lines[y] = [];
        lines[y].push(item);
      });
      
      // Sort lines by Y position (top to bottom)
      const sortedYs = Object.keys(lines).map(Number).sort((a, b) => b - a);
      
      let pageText = `\n========== HALAMAN ${pageNum} ==========\n`;
      let prevY = null;
      
      sortedYs.forEach(y => {
        // Sort items in line by X position (left to right)
        const lineItems = lines[y].sort((a, b) => a.transform[4] - b.transform[4]);
        
        let lineText = '';
        let prevX = 0;
        let prevWidth = 0;
        
        lineItems.forEach((item, index) => {
          const currentX = item.transform[4];
          const itemWidth = item.width || 10;
          const fontSize = item.transform[0] || 12;
          const charWidth = fontSize * 0.6; // Approximate character width
          
          // Add spaces based on horizontal gap
          if (index > 0) {
            const gap = currentX - (prevX + prevWidth);
            
            if (gap > charWidth * 0.5) {
              // Calculate number of spaces needed
              const spaceCount = Math.max(1, Math.round(gap / charWidth));
              
              if (spaceCount > 1 && spaceCount <= 20) {
                // Add calculated spaces for proper alignment
                lineText += ' '.repeat(Math.min(spaceCount, 10));
              } else if (spaceCount > 20) {
                // Use tab for very large gaps (likely column separation)
                lineText += '\t';
              } else {
                // Single space for normal word separation
                lineText += ' ';
              }
            }
          }
          
          lineText += item.str;
          prevX = currentX;
          prevWidth = itemWidth;
        });
        
        // Add line breaks for vertical spacing
        if (prevY !== null) {
          const verticalGap = prevY - y;
          const lineHeight = 12; // Approximate line height
          
          if (verticalGap > lineHeight * 1.5) {
            // Add extra line break for paragraph separation
            pageText += '\n';
          }
        }
        
        if (lineText.trim()) {
          pageText += lineText + '\n';
        }
        
        prevY = y;
      });
      
      fullText += pageText + '\n';
      page.cleanup();
    }
    
    pdfDocument.destroy();
    
    return {
      text: fullText,
      metadata: metadata,
      method: 'Enhanced pdfjs-dist with Layout Preservation',
      textLength: fullText.length,
      success: true
    };
  } catch (error) {
    throw new Error(`Layout-preserved extraction failed: ${error.message}`);
  }
}

// Basic pdfjs-dist extraction (fallback)
async function extractWithBasicPdfjs(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const uint8Array = new Uint8Array(dataBuffer);
    
    const pdfDocument = await pdfjsLib.getDocument({
      data: uint8Array
    }).promise;
    
    const numPages = pdfDocument.numPages;
    let fullText = '';
    
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      let pageText = `\n=== HALAMAN ${pageNum} ===\n`;
      textContent.items.forEach(item => {
        pageText += item.str + ' ';
      });
      
      fullText += pageText + '\n';
      page.cleanup();
    }
    
    pdfDocument.destroy();
    
    return {
      text: fullText,
      method: 'Basic pdfjs-dist',
      textLength: fullText.length,
      success: true
    };
  } catch (error) {
    throw new Error(`Basic pdfjs extraction failed: ${error.message}`);
  }
}

// Hybrid extraction dengan multiple methods
async function extractPdfText(filePath) {
  const methods = [
    { name: 'layout-preserved', func: extractWithLayoutPreservation },
    { name: 'basic-pdfjs', func: extractWithBasicPdfjs }
  ];
  
  let lastError = null;
  
  for (const method of methods) {
    try {
      console.log(`Trying extraction method: ${method.name}`);
      const result = await method.func(filePath);
      
      if (result.success && result.text && result.text.trim().length > 0) {
        console.log(`✅ Success with method: ${method.name}`);
        return result;
      }
    } catch (error) {
      console.warn(`❌ Method ${method.name} failed:`, error.message);
      lastError = error;
      continue;
    }
  }
  
  // All methods failed, return error
  throw new Error(`All extraction methods failed. Last error: ${lastError?.message}`);
}

// Format text untuk display yang lebih baik
function formatPdfTextToHtml(text, metadata = {}) {
  if (!text) return '';
  
  // Escape HTML characters
  let htmlText = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  
  // Convert line breaks to HTML
  htmlText = htmlText.replace(/\n/g, '<br>');
  
  // Preserve spaces and tabs
  htmlText = htmlText.replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
  htmlText = htmlText.replace(/  /g, '&nbsp;&nbsp;');
  
  // Style page headers
  htmlText = htmlText.replace(
    /=+\s*HALAMAN\s+(\d+)\s*=+/gi,
    '<div class="page-header">📄 HALAMAN $1</div>'
  );
  
  // Add metadata header if available
  let metadataHtml = '';
  if (metadata && Object.keys(metadata).length > 0) {
    metadataHtml = '<div class="pdf-metadata">';
    metadataHtml += '<h3>📋 Informasi Dokumen</h3>';
    if (metadata.title) metadataHtml += `<p><strong>Judul:</strong> ${metadata.title}</p>`;
    if (metadata.author) metadataHtml += `<p><strong>Penulis:</strong> ${metadata.author}</p>`;
    if (metadata.subject) metadataHtml += `<p><strong>Subjek:</strong> ${metadata.subject}</p>`;
    if (metadata.creator) metadataHtml += `<p><strong>Pembuat:</strong> ${metadata.creator}</p>`;
    if (metadata.numPages) metadataHtml += `<p><strong>Jumlah Halaman:</strong> ${metadata.numPages}</p>`;
    metadataHtml += '</div><hr>';
  }
  
  return metadataHtml + '<div class="pdf-text-content">' + htmlText + '</div>';
}

/* GET users listing. */
router.get('/', (req, res, next) => {
  res.send('respond with a resource');
});

/* POST upload PDF */
router.post('/upload-pdf', upload.single('pdf'), (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Tidak ada file yang diupload atau file bukan PDF'
      });
    }

    // Informasi file yang berhasil diupload
    var fileInfo = {
      originalName: req.file.originalname,
      filename: req.file.filename,
      path: req.file.path,
      size: req.file.size,
      uploadDate: new Date()
    };

    res.json({
      success: true,
      message: 'File PDF berhasil diupload',
      data: fileInfo
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupload file',
      error: error.message
    });
  }
});

/* GET daftar file PDF yang sudah diupload */
router.get('/pdfs', (req, res, next) => {
  try {
    var uploadsPath = path.join(__dirname, '..', 'uploads', 'pdfs');
    
    if (!fs.existsSync(uploadsPath)) {
      return res.json({
        success: true,
        message: 'Belum ada file PDF yang diupload',
        data: []
      });
    }

    var files = fs.readdirSync(uploadsPath);
    var pdfFiles = files.filter(file => path.extname(file).toLowerCase() === '.pdf');
    
    var fileList = pdfFiles.map(filename => {
      var filePath = path.join(uploadsPath, filename);
      var stats = fs.statSync(filePath);
      
      return {
        filename: filename,
        size: stats.size,
        uploadDate: stats.birthtime,
        modifiedDate: stats.mtime
      };
    });

    res.json({
      success: true,
      message: 'Daftar file PDF berhasil diambil',
      data: fileList
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil daftar file',
      error: error.message
    });
  }
});

/* GET download PDF by filename */
router.get('/download/:filename', (req, res, next) => {
  try {
    var filename = req.params.filename;
    var filePath = path.join(__dirname, '..', 'uploads', 'pdfs', filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File tidak ditemukan'
      });
    }

    res.download(filePath, filename, (err) => {
      if (err) {
        res.status(500).json({
          success: false,
          message: 'Terjadi kesalahan saat mendownload file',
          error: err.message
        });
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mendownload file',
      error: error.message
    });
  }
});

/* POST parse PDF dengan layout preservation */
router.post('/parse-pdf', upload.single('pdf'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Tidak ada file PDF yang diupload'
      });
    }

    const filePath = req.file.path;
    console.log(`Starting PDF parsing for: ${req.file.originalname}`);
    
    // Extract text dengan layout preservation
    const extractResult = await extractPdfText(filePath);
    
    // Save extracted text to file for future reference
    const textFileName = req.file.filename.replace('.pdf', '.txt');
    const textFilePath = path.join(path.dirname(filePath), textFileName);
    fs.writeFileSync(textFilePath, extractResult.text, 'utf8');
    
    res.json({
      success: true,
      message: 'PDF berhasil diparsing dengan preservasi layout',
      data: {
        originalName: req.file.originalname,
        filename: req.file.filename,
        textFileName: textFileName,
        extractionMethod: extractResult.method,
        textLength: extractResult.textLength,
        metadata: extractResult.metadata || {},
        previewText: extractResult.text.substring(0, 500) + (extractResult.text.length > 500 ? '...' : ''),
        size: req.file.size,
        uploadDate: new Date()
      }
    });

  } catch (error) {
    console.error('PDF parsing error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat parsing PDF',
      error: error.message
    });
  }
});

/* GET parse existing PDF file */
router.get('/parse/:filename', async (req, res, next) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, '..', 'uploads', 'pdfs', filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File PDF tidak ditemukan'
      });
    }

    console.log(`Parsing existing PDF: ${filename}`);
    
    // Extract text dengan layout preservation
    const extractResult = await extractPdfText(filePath);
    
    // Save extracted text to file
    const textFileName = filename.replace('.pdf', '.txt');
    const textFilePath = path.join(path.dirname(filePath), textFileName);
    fs.writeFileSync(textFilePath, extractResult.text, 'utf8');
    
    res.json({
      success: true,
      message: 'PDF berhasil diparsing dengan preservasi layout',
      data: {
        filename: filename,
        textFileName: textFileName,
        extractionMethod: extractResult.method,
        textLength: extractResult.textLength,
        metadata: extractResult.metadata || {},
        previewText: extractResult.text.substring(0, 500) + (extractResult.text.length > 500 ? '...' : '')
      }
    });

  } catch (error) {
    console.error('PDF parsing error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat parsing PDF',
      error: error.message
    });
  }
});

/* GET view parsed PDF content */
router.get('/view/:filename', (req, res, next) => {
  try {
    const filename = req.params.filename;
    const textFileName = filename.replace('.pdf', '.txt');
    const textFilePath = path.join(__dirname, '..', 'uploads', 'pdfs', textFileName);

    if (!fs.existsSync(textFilePath)) {
      return res.status(404).json({
        success: false,
        message: 'File teks hasil parsing tidak ditemukan. Silakan parse ulang PDF.'
      });
    }

    const textContent = fs.readFileSync(textFilePath, 'utf8');
    const htmlContent = formatPdfTextToHtml(textContent);

    // Create HTML page untuk menampilkan hasil
    const htmlPage = `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hasil Parsing PDF - ${filename}</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
            line-height: 1.6;
        }
        .container {
            max-width: 210mm;
            margin: 0 auto;
            background: white;
            padding: 40px;
            box-shadow: 0 0 20px rgba(0,0,0,0.1);
            border-radius: 8px;
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid #667eea;
        }
        .header h1 {
            color: #667eea;
            margin-bottom: 10px;
        }
        .pdf-metadata {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
            border-left: 4px solid #667eea;
        }
        .pdf-metadata h3 {
            margin-top: 0;
            color: #333;
        }
        .pdf-text-content {
            font-family: 'Courier New', Monaco, monospace;
            font-size: 12px;
            line-height: 1.4;
            white-space: pre-wrap;
            word-wrap: break-word;
            color: #333;
        }
        .page-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 10px 20px;
            margin: 30px 0 20px 0;
            border-radius: 5px;
            text-align: center;
            font-weight: bold;
        }
        .actions {
            margin-bottom: 20px;
            text-align: center;
        }
        .btn {
            display: inline-block;
            padding: 10px 20px;
            margin: 5px;
            background: #667eea;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            transition: background 0.3s;
        }
        .btn:hover {
            background: #5a67d8;
            text-decoration: none;
            color: white;
        }
        .stats {
            background: #e3f2fd;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📄 Hasil Parsing PDF</h1>
            <p><strong>File:</strong> ${filename}</p>
        </div>
        
        <div class="actions">
            <a href="/api/download/${filename}" class="btn">📥 Download PDF Asli</a>
            <a href="/test" class="btn">🔙 Kembali ke Upload</a>
            <button onclick="window.print()" class="btn">🖨️ Print</button>
        </div>
        
        <div class="stats">
            <strong>📊 Statistik:</strong><br>
            Jumlah karakter: ${textContent.length.toLocaleString('id-ID')}<br>
            Metode ekstraksi: Enhanced pdfjs-dist with Layout Preservation<br>
            Waktu parsing: ${new Date().toLocaleString('id-ID')}
        </div>
        
        ${htmlContent}
    </div>

    <script>
        // Add copy to clipboard functionality
        document.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                // Allow Ctrl+A to select all
            }
        });
    </script>
</body>
</html>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(htmlPage);

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat menampilkan hasil parsing',
      error: error.message
    });
  }
});

module.exports = router;
