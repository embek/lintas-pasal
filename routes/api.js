const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

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
      cb(new Error('Hanya file PDF yang diperbolehkan!'), false);
    }
  }
});

// Function to parse legal document content into structured JSON
function parsePeraturanToJSON(rawText) {
  const lines = rawText.split(/\r?\n/);
  const result = {};
  let isInContent = false;
  let currentBab = null;
  let currentBagian = null;
  let currentPasal = null;
  let currentAyat = [];

  // Enhanced regex patterns untuk mendeteksi struktur dokumen
  const regexIgnore = /^\s*(DAFTAR ISI|LAMPIRAN|PENJELASAN|BERITA NEGARA|LEMBARAN NEGARA|jdih\.pu\.go\.id|Menimbang|Mengingat|www\.|^\d{4}, No\.?\d+|^\d{1,3}\s*-?$|KEMENTERIAN|PRESIDEN|UNDANG-UNDANG|PERATURAN|RI|PENDAHULUAN|TAMBAHAN LEMBARAN NEGARA|DENGAN RAHMAT|MEMUTUSKAN|MENETAPKAN|KEPUTUSAN|SALINAN|PERATURAN MENTERI|PERATURAN PEMERINTAH)/i;
  const regexBab = /^BAB\s+([IVXLCDM]+|[0-9]+)\b/i;
  const regexPasal = /^(Pasal\s+\d+[A-Z]*)/i;
  const regexBagian = /^(Bagian\s+(Kesatu|Kedua|Ketiga|Keempat|Kelima|Keenam|Ketujuh|Kedelapan|Kesembilan|Kesepuluh|[A-Za-z\s]+)|Subbagian\s+\w+|Paragraf\s+\d+)/i;
  const regexKetentuan = /^(Ketentuan\s+Umum|Ketentuan\s+Khusus|Ketentuan\s+Peralihan|Ketentuan\s+Penutup)\b/i;
  const regexAyat = /^\(\d+\)\s*/;
  const regexPageNumber = /^\s*\d+\s*$/;

  // Helper function untuk menyimpan pasal saat ini
  const saveCurrentPasal = () => {
    if (currentPasal && currentAyat.length > 0) {
      // Bersihkan ayat dari spasi berlebih
      const cleanedAyat = currentAyat.map(ayat => ayat.trim()).filter(ayat => ayat.length > 0);
      
      if (currentBagian) {
        // Jika ada bagian, simpan pasal di dalam bagian
        if (!result[currentBab].bagian[currentBagian].pasal) {
          result[currentBab].bagian[currentBagian].pasal = {};
        }
        result[currentBab].bagian[currentBagian].pasal[currentPasal] = {
          isi: cleanedAyat
        };
      } else {
        // Jika tidak ada bagian, simpan pasal langsung di bawah BAB
        result[currentBab].bagian[currentPasal] = {
          isi: cleanedAyat
        };
      }
      currentAyat = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // Skip empty lines, ignored patterns, dan page numbers
    if (!line || regexIgnore.test(line) || regexPageNumber.test(line)) {
      continue;
    }

    // Deteksi mulai content dari BAB atau Pasal
    if (!isInContent && (regexBab.test(line) || regexPasal.test(line))) {
      isInContent = true;
    }

    if (isInContent) {
      // Handle BAB sections
      const babMatch = regexBab.exec(line);
      if (babMatch) {
        saveCurrentPasal(); // Simpan pasal sebelumnya jika ada
        
        const babKey = `BAB ${babMatch[1]}`;
        currentBab = babKey;
        currentBagian = null;
        currentPasal = null;
        
        // Cek baris berikutnya untuk judul BAB
        let judulBab = '';
        let nextLineIndex = i + 1;
        
        // Skip beberapa baris untuk mencari judul yang sesuai
        while (nextLineIndex < lines.length) {
          const nextLine = lines[nextLineIndex].trim();
          if (!nextLine) {
            nextLineIndex++;
            continue;
          }
          
          if (!regexBab.test(nextLine) && !regexPasal.test(nextLine) && 
              !regexBagian.test(nextLine) && !regexKetentuan.test(nextLine) && 
              nextLine.length > 3 && !regexPageNumber.test(nextLine)) {
            judulBab = nextLine;
            i = nextLineIndex; // Skip baris yang sudah diproses
            break;
          }
          break;
        }
        
        result[currentBab] = {
          judul: judulBab,
          bagian: {}
        };
        continue;
      }

      // Handle Bagian/Ketentuan sections
      const bagianMatch = regexBagian.exec(line) || regexKetentuan.exec(line);
      if (bagianMatch && currentBab) {
        saveCurrentPasal(); // Simpan pasal sebelumnya jika ada
        
        currentBagian = bagianMatch[1];
        currentPasal = null;
        
        // Cek baris berikutnya untuk judul bagian
        let judulBagian = '';
        let nextLineIndex = i + 1;
        
        while (nextLineIndex < lines.length) {
          const nextLine = lines[nextLineIndex].trim();
          if (!nextLine) {
            nextLineIndex++;
            continue;
          }
          
          if (!regexBab.test(nextLine) && !regexPasal.test(nextLine) && 
              !regexBagian.test(nextLine) && !regexKetentuan.test(nextLine) && 
              nextLine.length > 3 && !regexPageNumber.test(nextLine)) {
            judulBagian = nextLine;
            i = nextLineIndex; // Skip baris yang sudah diproses
            break;
          }
          break;
        }
        
        result[currentBab].bagian[currentBagian] = {
          judul: judulBagian,
          pasal: {}
        };
        continue;
      }

      // Handle Pasal sections
      const pasalMatch = regexPasal.exec(line);
      if (pasalMatch && currentBab) {
        saveCurrentPasal(); // Simpan pasal sebelumnya jika ada
        
        currentPasal = pasalMatch[1];
        currentAyat = [];
        continue;
      }

      // Handle content lines (isi pasal)
      if (currentBab && currentPasal && line.length > 3) {
        // Cek apakah ini ayat baru
        if (regexAyat.test(line)) {
          currentAyat.push(line);
        } else {
          // Mungkin lanjutan ayat sebelumnya atau konten standalone
          if (currentAyat.length > 0) {
            // Gabungkan dengan ayat terakhir
            const lastIndex = currentAyat.length - 1;
            currentAyat[lastIndex] += ' ' + line;
          } else {
            // Konten standalone (tanpa nomor ayat)
            currentAyat.push(line);
          }
        }
      }
    }
  }

  // Simpan pasal terakhir
  saveCurrentPasal();

  return result;
}

// Function to convert JSON structure to formatted text for display
function formatJSONForDisplay(jsonData) {
  let formattedText = '';
  
  for (const [babKey, babData] of Object.entries(jsonData)) {
    // Format BAB
    const babTitle = babData.judul ? `${babKey} ${babData.judul}` : babKey;
    formattedText += `<div class="alert alert-success mt-4 mb-3"><h4 class="mb-0"><i class="fas fa-book me-2"></i>${babTitle}</h4></div>\n`;
    
    for (const [bagianKey, bagianData] of Object.entries(babData.bagian)) {
      if (bagianKey.startsWith('Pasal')) {
        // Direct pasal under BAB (no bagian)
        formattedText += `<div class="card border-primary mt-3 mb-2">
          <div class="card-header bg-primary text-white">
            <h5 class="mb-0"><i class="fas fa-balance-scale me-2"></i>${bagianKey}</h5>
          </div>
          <div class="card-body">`;
        
        if (bagianData.isi) {
          for (const isi of bagianData.isi) {
            formattedText += formatIsiContent(isi);
          }
        }
        
        formattedText += `</div></div>\n`;
      } else {
        // Bagian section
        const bagianTitle = bagianData.judul ? `${bagianKey} - ${bagianData.judul}` : bagianKey;
        formattedText += `<div class="alert alert-info mt-3 mb-2"><h6 class="mb-0"><i class="fas fa-layer-group me-2"></i>${bagianTitle}</h6></div>\n`;
        
        if (bagianData.pasal) {
          for (const [pasalKey, pasalData] of Object.entries(bagianData.pasal)) {
            formattedText += `<div class="card border-primary mt-3 mb-2">
              <div class="card-header bg-primary text-white">
                <h5 class="mb-0"><i class="fas fa-balance-scale me-2"></i>${pasalKey}</h5>
              </div>
              <div class="card-body">`;
            
            if (pasalData.isi) {
              for (const isi of pasalData.isi) {
                formattedText += formatIsiContent(isi);
              }
            }
            
            formattedText += `</div></div>\n`;
          }
        }
      }
    }
  }
  
  return formattedText;
}

// Helper function to format individual content items
function formatIsiContent(isi) {
  let content = isi
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  // Format ayat numbers (1), (2), etc.
  content = content.replace(/^\((\d+)\)\s*/, '<div class="mt-2"><strong class="text-primary fs-6">($1)</strong> ');
  
  // Format letter items a., b., c., etc.
  content = content.replace(/^([a-z]\.)\s*/, '<div class="ms-3 mt-1"><span class="text-success fw-bold">$1</span> ');
  
  // Format number items 1., 2., 3., etc.
  content = content.replace(/^(\d+\.)\s*/, '<div class="ms-4 mt-1"><span class="text-warning fw-bold">$1</span> ');
  
  // If no special formatting was applied, wrap in a simple div
  if (!content.startsWith('<div')) {
    content = `<div class="mt-1">${content}</div>`;
  } else {
    content += '</div>';
  }
  
  return content + '\n';
}

// Enhanced text formatting for better HTML display (updated to use JSON)
function formatTextForDisplay(text) {
  try {
    // Try to parse as JSON first
    const jsonData = JSON.parse(text);
    return formatJSONForDisplay(jsonData);
  } catch (e) {
    // Fallback to plain text formatting if not JSON
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }
}

// Enhanced PDF text extraction dengan JSON parsing
async function extractPdfText(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const uint8Array = new Uint8Array(dataBuffer);
    
    const pdfDocument = await pdfjsLib.getDocument({ data: uint8Array }).promise;
    const numPages = pdfDocument.numPages;
    let fullText = '';
    
    // Extract raw text dari semua halaman
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      const strings = textContent.items.map(item => item.str);
      const pageText = strings.join('\n');
      fullText += pageText + '\n';
      
      page.cleanup();
    }
    
    pdfDocument.destroy();
    
    // Parse ke struktur JSON sesuai format yang diminta
    const jsonStructure = parsePeraturanToJSON(fullText);
    
    // Konversi JSON ke string dengan format yang rapi
    const jsonText = JSON.stringify(jsonStructure, null, 2);
    
    // Hitung statistik
    const stats = {
      totalBab: Object.keys(jsonStructure).length,
      totalPasal: 0,
      totalBagian: 0
    };
    
    // Hitung jumlah pasal dan bagian
    Object.values(jsonStructure).forEach(bab => {
      if (bab.bagian) {
        Object.values(bab.bagian).forEach(item => {
          if (item.isi) {
            // Ini adalah pasal langsung di bawah BAB
            stats.totalPasal++;
          } else if (item.pasal) {
            // Ini adalah bagian yang berisi pasal
            stats.totalBagian++;
            stats.totalPasal += Object.keys(item.pasal).length;
          }
        });
      }
    });
    
    return {
      text: jsonText,
      textLength: jsonText.length,
      numPages: numPages,
      rawTextLength: fullText.length,
      jsonStructure: jsonStructure,
      stats: stats
    };
  } catch (error) {
    throw new Error(`PDF extraction failed: ${error.message}`);
  }
}

// API Routes
router.get('/', (req, res) => {
  res.json({ message: 'PDF API Ready' });
});

router.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Tidak ada file yang diupload'
      });
    }

    // Extract text dan parse ke JSON
    const extractResult = await extractPdfText(req.file.path);
    
    // Simpan hasil JSON ke file .txt
    const textFileName = req.file.filename.replace('.pdf', '.txt');
    const textFilePath = path.join(path.dirname(req.file.path), textFileName);
    fs.writeFileSync(textFilePath, extractResult.text, 'utf8');

    // Simpan juga metadata JSON ke file terpisah untuk debugging
    const metadataFileName = req.file.filename.replace('.pdf', '.meta.json');
    const metadataFilePath = path.join(path.dirname(req.file.path), metadataFileName);
    fs.writeFileSync(metadataFilePath, JSON.stringify({
      originalFile: req.file.originalname,
      processedAt: new Date().toISOString(),
      stats: extractResult.stats,
      structure: extractResult.jsonStructure
    }, null, 2), 'utf8');

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
        structure: {
          totalBab: extractResult.stats.totalBab,
          totalBagian: extractResult.stats.totalBagian,
          totalPasal: extractResult.stats.totalPasal
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengupload dan parsing file',
      error: error.message
    });
  }
});

router.get('/files', (req, res) => {
  try {
    const uploadsPath = path.join(__dirname, '..', 'uploads', 'pdfs');
    
    if (!fs.existsSync(uploadsPath)) {
      return res.json({ success: true, files: [] });
    }

    const files = fs.readdirSync(uploadsPath);
    const pdfFiles = files.filter(file => path.extname(file).toLowerCase() === '.pdf');
    
    const fileList = pdfFiles.map(filename => {
      const filePath = path.join(uploadsPath, filename);
      const stats = fs.statSync(filePath);
      
      // Cek apakah ada file JSON yang sesuai
      const textFileName = filename.replace('.pdf', '.txt');
      const textFilePath = path.join(uploadsPath, textFileName);
      const metaFileName = filename.replace('.pdf', '.meta.json');
      const metaFilePath = path.join(uploadsPath, metaFileName);
      
      let jsonInfo = null;
      let hasJson = false;
      
      if (fs.existsSync(textFilePath)) {
        hasJson = true;
        try {
          const textContent = fs.readFileSync(textFilePath, 'utf8');
          const jsonData = JSON.parse(textContent);
          
          // Hitung statistik dasar
          let jsonStats = {
            totalBab: Object.keys(jsonData).length,
            totalPasal: 0,
            totalBagian: 0
          };
          
          Object.values(jsonData).forEach(bab => {
            if (bab.bagian) {
              Object.values(bab.bagian).forEach(item => {
                if (item.isi) {
                  jsonStats.totalPasal++;
                } else if (item.pasal) {
                  jsonStats.totalBagian++;
                  jsonStats.totalPasal += Object.keys(item.pasal).length;
                }
              });
            }
          });
          
          jsonInfo = {
            isValid: true,
            size: textContent.length,
            stats: jsonStats
          };
          
        } catch (e) {
          jsonInfo = {
            isValid: false,
            size: fs.statSync(textFilePath).size,
            error: 'Invalid JSON format'
          };
        }
      }
      
      return {
        filename: filename,
        size: stats.size,
        uploadDate: stats.birthtime,
        hasJson: hasJson,
        jsonInfo: jsonInfo
      };
    });

    // Sort by upload date (newest first)
    fileList.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

    res.json({ 
      success: true, 
      files: fileList,
      summary: {
        totalFiles: fileList.length,
        withJson: fileList.filter(f => f.hasJson).length,
        validJson: fileList.filter(f => f.jsonInfo && f.jsonInfo.isValid).length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil daftar file',
      error: error.message
    });
  }
});

router.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, '..', 'uploads', 'pdfs', filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File tidak ditemukan');
  }
  
  res.download(filePath, filename);
});

router.get('/view/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const textFileName = filename.replace('.pdf', '.txt');
    const textFilePath = path.join(__dirname, '..', 'uploads', 'pdfs', textFileName);

    if (!fs.existsSync(textFilePath)) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="id">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>File Tidak Ditemukan</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
            <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
            <style>
              body { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; }
              .error-card { background: white; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="row justify-content-center align-items-center min-vh-100">
                    <div class="col-12 col-md-8">
                        <div class="error-card p-4 text-center">
                            <i class="fas fa-file-excel text-danger mb-3" style="font-size: 3rem;"></i>
                            <h4 class="text-danger">File JSON Tidak Ditemukan</h4>
                            <p class="text-muted">File hasil parsing JSON tidak ditemukan. Silakan upload ulang PDF untuk memproses ulang.</p>
                            <a href="/test" class="btn btn-primary">
                                <i class="fas fa-arrow-left me-2"></i>Kembali ke Upload
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </body>
        </html>
      `);
    }

    const textContent = fs.readFileSync(textFilePath, 'utf8');
    let jsonData;
    let formattedContent;
    let isValidJSON = false;

    try {
      // Coba parse sebagai JSON
      jsonData = JSON.parse(textContent);
      formattedContent = formatJSONForDisplay(jsonData);
      isValidJSON = true;
    } catch (e) {
      // Jika bukan JSON valid, tampilkan sebagai teks biasa
      formattedContent = textContent
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
    }

    // Hitung statistik dari JSON jika valid
    let stats = {
      totalBab: 0,
      totalBagian: 0,
      totalPasal: 0,
      totalAyat: 0
    };

    if (isValidJSON && jsonData) {
      stats.totalBab = Object.keys(jsonData).length;
      
      Object.values(jsonData).forEach(bab => {
        if (bab.bagian) {
          Object.values(bab.bagian).forEach(item => {
            if (item.isi) {
              // Pasal langsung di bawah BAB
              stats.totalPasal++;
              stats.totalAyat += item.isi.length;
            } else if (item.pasal) {
              // Bagian yang berisi pasal
              stats.totalBagian++;
              Object.values(item.pasal).forEach(pasal => {
                stats.totalPasal++;
                if (pasal.isi) {
                  stats.totalAyat += pasal.isi.length;
                }
              });
            }
          });
        }
      });
    }
    
    const htmlPage = `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hasil Parsing PDF (JSON) - ${filename}</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        body {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            overflow-x: hidden;
        }
        .pdf-content {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            font-size: 14px;
            line-height: 1.8;
            word-wrap: break-word;
        }
        .navbar-brand {
            font-weight: bold;
        }
        .stats-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        .main-content {
            background: white;
            border-radius: 15px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            margin: 0 10px;
        }
        .json-badge {
            background: linear-gradient(45deg, #28a745, #20c997);
            color: white;
            padding: 0.25rem 0.5rem;
            border-radius: 0.375rem;
            font-size: 0.75rem;
            font-weight: 600;
        }
        @media print {
            .no-print { display: none !important; }
            .pdf-content { font-size: 12px; }
            body { background: white !important; }
            .main-content { box-shadow: none !important; margin: 0 !important; }
        }
        @media (max-width: 768px) {
            .container-fluid { padding: 0 5px; }
            .main-content { margin: 0 5px; border-radius: 10px; }
            .pdf-content { font-size: 13px; }
            .btn-group .btn { padding: 0.375rem 0.5rem; font-size: 0.875rem; }
            .stats-card .col-6 { margin-bottom: 1rem; }
        }
        @media (max-width: 576px) {
            .btn-group { flex-direction: column; width: 100%; }
            .btn-group .btn { margin-bottom: 0.5rem; border-radius: 0.375rem !important; }
        }
    </style>
</head>
<body>
    <!-- Navbar -->
    <nav class="navbar navbar-expand-lg navbar-dark bg-primary no-print sticky-top">
        <div class="container-fluid">
            <a class="navbar-brand" href="/">
                <i class="fas fa-file-pdf me-2"></i>Lintas Pasal
            </a>
            <div class="navbar-nav ms-auto">
                <a class="nav-link text-white" href="/test">
                    <i class="fas fa-upload me-1"></i>Upload PDF
                </a>
            </div>
        </div>
    </nav>

    <div class="container-fluid py-4">
        <div class="row justify-content-center">
            <div class="col-12 col-xl-10">
                <div class="main-content">
                    <!-- Header -->
                    <div class="p-4 border-bottom">
                        <div class="d-flex flex-column flex-md-row justify-content-between align-items-start">
                            <div class="flex-grow-1 mb-3 mb-md-0">
                                <h4 class="text-primary mb-2">
                                    <i class="fas fa-file-pdf me-2"></i>Hasil Parsing PDF 
                                    ${isValidJSON ? '<span class="json-badge ms-2"><i class="fas fa-code me-1"></i>JSON Format</span>' : ''}
                                </h4>
                                <h6 class="text-muted mb-0">📄 ${filename}</h6>
                            </div>
                            
                            <!-- Action Buttons -->
                            <div class="btn-group no-print" role="group">
                                <a href="/api/download/${filename}" class="btn btn-success btn-sm">
                                    <i class="fas fa-download me-1"></i>Download PDF
                                </a>
                                <a href="/test" class="btn btn-secondary btn-sm">
                                    <i class="fas fa-arrow-left me-1"></i>Kembali
                                </a>
                                <button onclick="window.print()" class="btn btn-info btn-sm">
                                    <i class="fas fa-print me-1"></i>Print
                                </button>
                                <button onclick="copyToClipboard()" class="btn btn-warning btn-sm">
                                    <i class="fas fa-copy me-1"></i>Copy JSON
                                </button>
                            </div>
                        </div>
                        
                        <!-- Stats -->
                        <div class="row mt-3">
                            <div class="col-12">
                                <div class="card stats-card">
                                    <div class="card-body py-3">
                                        <div class="row text-center">
                                            <div class="col-6 col-md-3">
                                                <small class="d-block opacity-75">� Total BAB</small>
                                                <strong>${stats.totalBab}</strong>
                                            </div>
                                            <div class="col-6 col-md-3">
                                                <small class="d-block opacity-75">📑 Total Bagian</small>
                                                <strong>${stats.totalBagian}</strong>
                                            </div>
                                            <div class="col-6 col-md-3">
                                                <small class="d-block opacity-75">⚖️ Total Pasal</small>
                                                <strong>${stats.totalPasal}</strong>
                                            </div>
                                            <div class="col-6 col-md-3">
                                                <small class="d-block opacity-75">📝 Total Ayat</small>
                                                <strong>${stats.totalAyat}</strong>
                                            </div>
                                        </div>
                                        <div class="row text-center mt-2">
                                            <div class="col-6 col-md-3">
                                                <small class="d-block opacity-75">📊 Ukuran JSON</small>
                                                <strong>${(textContent.length / 1024).toFixed(1)} KB</strong>
                                            </div>
                                            <div class="col-6 col-md-3">
                                                <small class="d-block opacity-75">⚡ Format</small>
                                                <strong>${isValidJSON ? 'JSON Valid' : 'Plain Text'}</strong>
                                            </div>
                                            <div class="col-12 col-md-6 mt-2 mt-md-0">
                                                <small class="d-block opacity-75">🕒 Waktu Parsing</small>
                                                <strong>${new Date().toLocaleString('id-ID')}</strong>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- PDF Content -->
                    <div class="p-4">
                        <div class="pdf-content">
                            ${formattedContent}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Footer -->
    <footer class="bg-dark text-white text-center py-3 mt-4 no-print">
        <div class="container">
            <p class="mb-0 small">© 2025 Lintas Pasal - PDF Parser & JSON Viewer</p>
        </div>
    </footer>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
    <script>
        function copyToClipboard() {
            const textContent = \`${textContent.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;
            navigator.clipboard.writeText(textContent).then(() => {
                // Show success message
                const btn = event.target.closest('button');
                const originalText = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-check me-1"></i>Copied!';
                btn.classList.add('btn-success');
                btn.classList.remove('btn-warning');
                
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.classList.add('btn-warning');
                    btn.classList.remove('btn-success');
                }, 2000);
            }).catch(() => {
                alert('❌ Gagal menyalin JSON');
            });
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
                e.preventDefault();
                window.print();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'c' && e.altKey) {
                e.preventDefault();
                copyToClipboard();
            }
        });
    </script>
</body>
</html>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(htmlPage);

  } catch (error) {
    res.status(500).send(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Error</title>
          <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
          <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
      </head>
      <body class="bg-light">
          <div class="container mt-5">
              <div class="row justify-content-center">
                  <div class="col-md-8">
                      <div class="alert alert-danger text-center">
                          <h4><i class="fas fa-exclamation-triangle me-2"></i>Terjadi Kesalahan</h4>
                          <p>${error.message}</p>
                          <a href="/test" class="btn btn-primary">
                            <i class="fas fa-arrow-left me-2"></i>Kembali ke Upload
                          </a>
                      </div>
                  </div>
              </div>
          </div>
      </body>
      </html>
    `);
  }
});

// Endpoint untuk mendapatkan data JSON langsung
router.get('/json/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const textFileName = filename.replace('.pdf', '.txt');
    const textFilePath = path.join(__dirname, '..', 'uploads', 'pdfs', textFileName);

    if (!fs.existsSync(textFilePath)) {
      return res.status(404).json({
        success: false,
        message: 'File JSON tidak ditemukan'
      });
    }

    const textContent = fs.readFileSync(textFilePath, 'utf8');
    
    try {
      // Parse sebagai JSON
      const jsonData = JSON.parse(textContent);
      
      // Hitung statistik
      let stats = {
        totalBab: Object.keys(jsonData).length,
        totalBagian: 0,
        totalPasal: 0,
        totalAyat: 0
      };

      Object.values(jsonData).forEach(bab => {
        if (bab.bagian) {
          Object.values(bab.bagian).forEach(item => {
            if (item.isi) {
              // Pasal langsung di bawah BAB
              stats.totalPasal++;
              stats.totalAyat += item.isi.length;
            } else if (item.pasal) {
              // Bagian yang berisi pasal
              stats.totalBagian++;
              Object.values(item.pasal).forEach(pasal => {
                stats.totalPasal++;
                if (pasal.isi) {
                  stats.totalAyat += pasal.isi.length;
                }
              });
            }
          });
        }
      });

      res.json({
        success: true,
        filename: filename,
        data: jsonData,
        stats: stats,
        metadata: {
          processedAt: new Date().toISOString(),
          fileSize: textContent.length
        }
      });

    } catch (parseError) {
      res.status(400).json({
        success: false,
        message: 'File bukan format JSON yang valid',
        error: parseError.message
      });
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil data JSON',
      error: error.message
    });
  }
});

// Endpoint untuk pencarian dalam JSON
router.get('/search/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const query = req.query.q;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        message: 'Query pencarian tidak boleh kosong'
      });
    }

    const textFileName = filename.replace('.pdf', '.txt');
    const textFilePath = path.join(__dirname, '..', 'uploads', 'pdfs', textFileName);

    if (!fs.existsSync(textFilePath)) {
      return res.status(404).json({
        success: false,
        message: 'File JSON tidak ditemukan'
      });
    }

    const textContent = fs.readFileSync(textFilePath, 'utf8');
    
    try {
      const jsonData = JSON.parse(textContent);
      const results = [];
      const searchTerm = query.toLowerCase();

      // Function untuk mencari di dalam struktur JSON
      function searchInStructure(data, babKey = '', bagianKey = '', pasalKey = '') {
        if (typeof data === 'string') {
          if (data.toLowerCase().includes(searchTerm)) {
            return {
              type: 'content',
              bab: babKey,
              bagian: bagianKey,
              pasal: pasalKey,
              content: data,
              match: data.toLowerCase().indexOf(searchTerm)
            };
          }
        } else if (Array.isArray(data)) {
          data.forEach((item, index) => {
            const result = searchInStructure(item, babKey, bagianKey, pasalKey);
            if (result) {
              result.ayat = index + 1;
              results.push(result);
            }
          });
        } else if (typeof data === 'object' && data !== null) {
          Object.entries(data).forEach(([key, value]) => {
            // Check if key matches search term
            if (key.toLowerCase().includes(searchTerm)) {
              results.push({
                type: 'title',
                bab: babKey,
                bagian: bagianKey,
                pasal: pasalKey,
                title: key,
                match: key.toLowerCase().indexOf(searchTerm)
              });
            }
            
            // Recursive search in values
            if (key === 'isi') {
              searchInStructure(value, babKey, bagianKey, pasalKey);
            } else if (key === 'pasal') {
              Object.entries(value).forEach(([pasalSubKey, pasalValue]) => {
                searchInStructure(pasalValue, babKey, bagianKey, pasalSubKey);
              });
            } else if (key === 'bagian') {
              Object.entries(value).forEach(([bagianSubKey, bagianValue]) => {
                if (bagianValue.isi) {
                  // Direct pasal under bab
                  searchInStructure(bagianValue, babKey, '', bagianSubKey);
                } else {
                  searchInStructure(bagianValue, babKey, bagianSubKey, '');
                }
              });
            } else {
              searchInStructure(value, babKey, bagianKey, pasalKey);
            }
          });
        }
      }

      // Search through all BABs
      Object.entries(jsonData).forEach(([babKey, babValue]) => {
        searchInStructure(babValue, babKey, '', '');
      });

      res.json({
        success: true,
        query: query,
        filename: filename,
        results: results,
        total: results.length
      });

    } catch (parseError) {
      res.status(400).json({
        success: false,
        message: 'File bukan format JSON yang valid',
        error: parseError.message
      });
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat melakukan pencarian',
      error: error.message
    });
  }
});

module.exports = router;
