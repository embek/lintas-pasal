const fs = require('fs');
const path = require('path');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

class LegalDocument {
  constructor() {
    this.uploadsDir = path.join(__dirname, '..', 'uploads', 'pdfs');
  }

  /**
   * Extract text from PDF file and convert to structured JSON
   * @param {string} filePath - Path to the PDF file
   * @returns {Promise<Object>} - Extraction result with text, stats, and structure
   */
  async extractTextFromPdf(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error('PDF file not found');
      }

      const dataBuffer = fs.readFileSync(filePath);
      const uint8Array = new Uint8Array(dataBuffer);
      let fullText = '';
      let numPages = 0;

      // Load the PDF document
      const pdfDocument = await pdfjsLib.getDocument({
        data: uint8Array,
        standardFontDataUrl: null,
        verbosity: 0
      }).promise;
      
      numPages = pdfDocument.numPages;

      // Extract text from each page
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdfDocument.getPage(pageNum);
        const textContent = await page.getTextContent();
        
        const strings = textContent.items.map(item => item.str);
        const pageText = strings.join('\n');
        fullText += pageText + '\n';
        
        page.cleanup();
      }
      
      pdfDocument.destroy();

      // Parse to JSON structure
      const jsonStructure = this.parsePeraturanToJSON(fullText);
      const jsonText = JSON.stringify(jsonStructure, null, 2);
      
      // Calculate statistics
      const stats = this.calculateStats(jsonStructure);
      
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

  /**
   * Parse legal document content into structured JSON
   * @param {string} rawText - Raw text from PDF
   * @returns {Object} - Structured JSON object
   */
  parsePeraturanToJSON(rawText) {
    const lines = rawText.split(/\r?\n/);
    const result = {};
    let isInContent = false;
    let currentBab = null;
    let currentBagian = null;
    let currentPasal = null;
    let currentAyat = [];

    // Enhanced regex patterns
    const regexIgnore = /^\s*(DAFTAR ISI|LAMPIRAN|PENJELASAN|BERITA NEGARA|LEMBARAN NEGARA|jdih\.pu\.go\.id|Menimbang|Mengingat|www\.|^\d{4}, No\.?\d+|^\d{1,3}\s*-?$|KEMENTERIAN|PRESIDEN|UNDANG-UNDANG|PERATURAN|RI|PENDAHULUAN|TAMBAHAN LEMBARAN NEGARA|DENGAN RAHMAT|MEMUTUSKAN|MENETAPKAN|KEPUTUSAN|SALINAN|PERATURAN MENTERI|PERATURAN PEMERINTAH)/i;
    const regexBab = /^BAB\s+([IVXLCDM]+|[0-9]+)\b/i;
    const regexPasal = /^(Pasal\s+\d+[A-Z]*)/i;
    const regexBagian = /^(Bagian\s+(Kesatu|Kedua|Ketiga|Keempat|Kelima|Keenam|Ketujuh|Kedelapan|Kesembilan|Kesepuluh|[A-Za-z\s]+)|Subbagian\s+\w+|Paragraf\s+\d+)/i;
    const regexKetentuan = /^(Ketentuan\s+Umum|Ketentuan\s+Khusus|Ketentuan\s+Peralihan|Ketentuan\s+Penutup)\b/i;
    const regexAyat = /^\(\d+\)\s*/;
    const regexPageNumber = /^\s*\d+\s*$/;

    // Helper function to save current pasal
    const saveCurrentPasal = () => {
      if (currentPasal && currentAyat.length > 0) {
        const cleanedAyat = currentAyat.map(ayat => ayat.trim()).filter(ayat => ayat.length > 0);
        
        if (currentBagian) {
          if (!result[currentBab].bagian[currentBagian].pasal) {
            result[currentBab].bagian[currentBagian].pasal = {};
          }
          result[currentBab].bagian[currentBagian].pasal[currentPasal] = {
            isi: cleanedAyat
          };
        } else {
          result[currentBab].bagian[currentPasal] = {
            isi: cleanedAyat
          };
        }
        
        currentAyat = [];
      }
    };

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();

      // Skip empty lines and ignored patterns
      if (!line || regexIgnore.test(line) || regexPageNumber.test(line)) {
        continue;
      }

      // Detect content start
      if (!isInContent && (regexBab.test(line) || regexPasal.test(line))) {
        isInContent = true;
      }

      if (isInContent) {
        // Handle BAB sections
        const babMatch = regexBab.exec(line);
        if (babMatch) {
          saveCurrentPasal();
          
          const babKey = `BAB ${babMatch[1]}`;
          currentBab = babKey;
          currentBagian = null;
          currentPasal = null;
          
          // Look for BAB title
          let judulBab = '';
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
              judulBab = nextLine;
              i = nextLineIndex;
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
          saveCurrentPasal();
          
          currentBagian = bagianMatch[1];
          currentPasal = null;
          
          // Look for section title
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
              i = nextLineIndex;
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
          saveCurrentPasal();
          
          currentPasal = pasalMatch[1];
          currentAyat = [];
          continue;
        }

        // Handle content lines
        if (currentBab && currentPasal && line.length > 3) {
          if (regexAyat.test(line)) {
            currentAyat.push(line);
          } else {
            if (currentAyat.length > 0) {
              const lastIndex = currentAyat.length - 1;
              currentAyat[lastIndex] += ' ' + line;
            } else {
              currentAyat.push(line);
            }
          }
        }
      }
    }

    // Save the last pasal
    saveCurrentPasal();

    return result;
  }

  /**
   * Calculate statistics from JSON structure
   * @param {Object} jsonStructure - Parsed JSON structure
   * @returns {Object} - Statistics object
   */
  calculateStats(jsonStructure) {
    const stats = {
      totalBab: Object.keys(jsonStructure).length,
      totalPasal: 0,
      totalBagian: 0,
      totalAyat: 0
    };
    
    Object.values(jsonStructure).forEach(bab => {
      if (bab.bagian) {
        Object.values(bab.bagian).forEach(item => {
          if (item.isi) {
            stats.totalPasal++;
            stats.totalAyat += item.isi.length;
          } else if (item.pasal) {
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
    
    return stats;
  }

  /**
   * Save extraction results to files
   * @param {string} filename - Original filename
   * @param {Object} extractResult - Extraction result
   * @returns {Promise<Object>} - Save result
   */
  async saveExtractionResults(filename, extractResult) {
    try {
      const textFileName = filename.replace('.pdf', '.txt');
      const textFilePath = path.join(this.uploadsDir, textFileName);
      fs.writeFileSync(textFilePath, extractResult.text, 'utf8');

      const metadataFileName = filename.replace('.pdf', '.meta.json');
      const metadataFilePath = path.join(this.uploadsDir, metadataFileName);
      fs.writeFileSync(metadataFilePath, JSON.stringify({
        originalFile: filename,
        processedAt: new Date().toISOString(),
        stats: extractResult.stats,
        structure: extractResult.jsonStructure
      }, null, 2), 'utf8');

      return {
        success: true,
        textFile: textFileName,
        metadataFile: metadataFileName
      };
    } catch (error) {
      throw new Error(`Failed to save extraction results: ${error.message}`);
    }
  }

  /**
   * Format JSON data for HTML display with Wikipedia styling
   * @param {Object} jsonData - Parsed JSON data
   * @returns {string} - Formatted HTML string
   */
  static formatJSONForDisplay(jsonData) {
    let html = this.generateTableOfContents(jsonData);
    
    html += '<div class="json-structure">';
    
    Object.keys(jsonData).forEach(babKey => {
      const bab = jsonData[babKey];
      
      html += `<div class="bab-section" id="${babKey}">`;
      html += `<h2 class="bab-title">
                 <i class="fas fa-book me-2"></i>${this.escapeHtml(bab.judul || babKey)}
               </h2>`;
      
      if (bab.bagian) {
        Object.keys(bab.bagian).forEach(bagianKey => {
          const bagian = bab.bagian[bagianKey];
          
          if (bagianKey === 'PASAL_LANGSUNG') {
            html += '<div class="pasal-langsung">';
            Object.keys(bagian).forEach(pasalKey => {
              const pasal = bagian[pasalKey];
              html += this.formatPasal(pasalKey, pasal);
            });
            html += '</div>';
          } else {
            html += `<div class="bagian-section" id="${bagianKey}">`;
            html += `<h3 class="bagian-title">
                       <i class="fas fa-folder me-2"></i>${this.escapeHtml(bagian.judul || bagianKey)}
                     </h3>`;
            
            if (bagian.pasal) {
              Object.keys(bagian.pasal).forEach(pasalKey => {
                const pasal = bagian.pasal[pasalKey];
                html += this.formatPasal(pasalKey, pasal);
              });
            }
            html += '</div>';
          }
        });
      }
      html += '</div>';
    });
    
    html += '</div>';
    return html;
  }

  /**
   * Format individual pasal for display
   * @param {string} pasalKey - Pasal identifier
   * @param {Object} pasal - Pasal data
   * @returns {string} - Formatted HTML
   */
  static formatPasal(pasalKey, pasal) {
    let html = `<div class="pasal-item" id="${pasalKey}">`;
    html += `<h4 class="pasal-title">
               <i class="fas fa-balance-scale me-2"></i>${this.escapeHtml(pasalKey)}
             </h4>`;
    
    if (pasal.isi && Array.isArray(pasal.isi)) {
      html += '<div class="pasal-content">';
      pasal.isi.forEach((ayat, index) => {
        html += `<div class="ayat-item">
                   <span class="ayat-number">${index + 1}</span>
                   ${this.escapeHtml(ayat)}
                 </div>`;
      });
      html += '</div>';
    }
    
    html += '</div>';
    return html;
  }

  /**
   * Generate table of contents for navigation
   * @param {Object} jsonData - JSON data
   * @returns {string} - HTML table of contents
   */
  static generateTableOfContents(jsonData) {
    let html = '<div class="content-nav">';
    html += '<h5><i class="fas fa-list me-2"></i>Daftar Isi</h5>';
    
    Object.keys(jsonData).forEach(babKey => {
      const bab = jsonData[babKey];
      html += `<div class="nav-item">
                 <a href="#${babKey}" class="nav-link fw-bold">
                   <i class="fas fa-book me-2"></i>${this.escapeHtml(bab.judul || babKey)}
                 </a>`;
      
      if (bab.bagian) {
        Object.keys(bab.bagian).forEach(bagianKey => {
          const bagian = bab.bagian[bagianKey];
          if (bagianKey !== 'PASAL_LANGSUNG') {
            html += `<a href="#${bagianKey}" class="nav-link ms-3">
                       <i class="fas fa-folder me-2"></i>${this.escapeHtml(bagian.judul || bagianKey)}
                     </a>`;
          }
        });
      }
      html += '</div>';
    });
    
    html += '</div>';
    return html;
  }

  /**
   * Escape HTML characters
   * @param {string} text - Text to escape
   * @returns {string} - Escaped text
   */
  static escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

module.exports = LegalDocument;
