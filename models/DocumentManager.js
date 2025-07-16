const fs = require('fs');
const path = require('path');

class DocumentManager {
  constructor() {
    this.uploadsDir = path.join(__dirname, '..', 'uploads', 'pdfs');
  }

  /**
   * Get list of all uploaded files with their metadata
   * @returns {Promise<Array>} - Array of file information objects
   */
  async getFileList() {
    try {
      if (!fs.existsSync(this.uploadsDir)) {
        return [];
      }

      const files = fs.readdirSync(this.uploadsDir);
      const pdfFiles = files.filter(file => file.endsWith('.pdf'));

      const fileList = pdfFiles.map(filename => {
        const filePath = path.join(this.uploadsDir, filename);
        const stats = fs.statSync(filePath);
        
        // Check for corresponding text file
        const textFileName = filename.replace('.pdf', '.txt');
        const textFilePath = path.join(this.uploadsDir, textFileName);
        
        let jsonInfo = null;
        let hasJson = false;
        
        if (fs.existsSync(textFilePath)) {
          hasJson = true;
          try {
            const textContent = fs.readFileSync(textFilePath, 'utf8');
            const jsonData = JSON.parse(textContent);
            
            // Calculate basic statistics
            let jsonStats = {
              totalBab: Object.keys(jsonData).length,
              totalPasal: 0,
              totalBagian: 0,
              totalAyat: 0
            };
            
            Object.values(jsonData).forEach(bab => {
              if (bab.bagian) {
                Object.values(bab.bagian).forEach(item => {
                  if (item.isi) {
                    jsonStats.totalPasal++;
                    jsonStats.totalAyat += item.isi.length;
                  } else if (item.pasal) {
                    jsonStats.totalBagian++;
                    Object.values(item.pasal).forEach(pasal => {
                      jsonStats.totalPasal++;
                      if (pasal.isi) {
                        jsonStats.totalAyat += pasal.isi.length;
                      }
                    });
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

      return fileList;
    } catch (error) {
      throw new Error(`Failed to get file list: ${error.message}`);
    }
  }

  /**
   * Get summary statistics for file list
   * @param {Array} fileList - List of files
   * @returns {Object} - Summary statistics
   */
  getFileListSummary(fileList) {
    return {
      totalFiles: fileList.length,
      withJson: fileList.filter(f => f.hasJson).length,
      validJson: fileList.filter(f => f.jsonInfo && f.jsonInfo.isValid).length
    };
  }

  /**
   * Check if file exists
   * @param {string} filename - File name to check
   * @returns {boolean} - File existence status
   */
  fileExists(filename) {
    const filePath = path.join(this.uploadsDir, filename);
    return fs.existsSync(filePath);
  }

  /**
   * Get file path
   * @param {string} filename - File name
   * @returns {string} - Full file path
   */
  getFilePath(filename) {
    return path.join(this.uploadsDir, filename);
  }

  /**
   * Read JSON content from file
   * @param {string} filename - PDF filename
   * @returns {Promise<Object>} - JSON data and metadata
   */
  async getJsonContent(filename) {
    return await this.readJsonContent(filename);
  }

  /**
   * Format plain text for display
   * @param {string} text - Plain text content
   * @returns {string} - Formatted HTML
   */
  static formatPlainText(text) {
    return `<div class="plain-text-content">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
  }

  /**
   * Delete files associated with a PDF
   * @param {string} filename - PDF filename
   * @returns {Promise<void>}
   */
  async deleteFiles(filename) {
    const files = [
      filename,
      filename.replace('.pdf', '.txt'),
      filename.replace('.pdf', '.meta.json')
    ];

    for (const file of files) {
      const filePath = path.join(this.uploadsDir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }
  async readJsonContent(filename) {
    try {
      const textFileName = filename.replace('.pdf', '.txt');
      const textFilePath = path.join(this.uploadsDir, textFileName);

      if (!fs.existsSync(textFilePath)) {
        throw new Error('JSON file not found');
      }

      const textContent = fs.readFileSync(textFilePath, 'utf8');
      
      try {
        const jsonData = JSON.parse(textContent);
        
        // Calculate statistics
        const stats = this.calculateStats(jsonData);
        
        // Get file size
        const fileStat = fs.statSync(textFilePath);
        const fileSize = Math.round(fileStat.size / 1024); // KB
        
        // Get processing time (if available)
        const metaFileName = filename.replace('.pdf', '.meta.json');
        const metaFilePath = path.join(this.uploadsDir, metaFileName);
        let parseTime = 'Unknown';
        
        if (fs.existsSync(metaFilePath)) {
          try {
            const metaContent = fs.readFileSync(metaFilePath, 'utf8');
            const metadata = JSON.parse(metaContent);
            const processedDate = new Date(metadata.processedAt);
            parseTime = processedDate.toLocaleString('id-ID');
          } catch (e) {
            // Ignore metadata errors
          }
        }
        
        return {
          success: true,
          data: jsonData,
          stats: stats,
          fileSize: fileSize,
          parseTime: parseTime,
          rawContent: textContent,
          isValidJSON: true
        };
        
      } catch (parseError) {
        // Return as plain text if not valid JSON
        return {
          success: true,
          data: null,
          stats: { totalBab: 0, totalBagian: 0, totalPasal: 0, totalAyat: 0 },
          fileSize: Math.round(fs.statSync(textFilePath).size / 1024),
          parseTime: 'Unknown',
          rawContent: textContent,
          isValidJSON: false
        };
      }
      
    } catch (error) {
      throw new Error(`Failed to read JSON content: ${error.message}`);
    }
  }

  /**
   * Calculate statistics from JSON data
   * @param {Object} jsonData - JSON data
   * @returns {Object} - Statistics
   */
  calculateStats(jsonData) {
    const stats = {
      totalBab: Object.keys(jsonData).length,
      totalBagian: 0,
      totalPasal: 0,
      totalAyat: 0
    };

    Object.values(jsonData).forEach(bab => {
      if (bab.bagian) {
        Object.values(bab.bagian).forEach(item => {
          if (item.isi) {
            // Direct pasal under BAB
            stats.totalPasal++;
            stats.totalAyat += item.isi.length;
          } else if (item.pasal) {
            // Section containing pasal
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
   * Search through JSON structure for specific terms
   * @param {Object} jsonData - Parsed JSON data
   * @param {string} searchTerm - Term to search for
   * @param {Object} options - Search options
   * @returns {Array} - Array of search results
   */
  static searchInJSON(jsonData, searchTerm, options = {}) {
    const {
      caseSensitive = false,
      exactMatch = false,
      searchInTitles = true,
      searchInContent = true
    } = options;

    const results = [];
    const term = caseSensitive ? searchTerm : searchTerm.toLowerCase();

    Object.keys(jsonData).forEach(babKey => {
      const bab = jsonData[babKey];
      
      // Search in BAB title
      if (searchInTitles && this.matchText(bab.judul, term, { caseSensitive, exactMatch })) {
        results.push({
          type: 'bab',
          key: babKey,
          title: bab.judul,
          match: 'title',
          context: bab.judul
        });
      }
      
      if (bab.bagian) {
        Object.keys(bab.bagian).forEach(bagianKey => {
          const bagian = bab.bagian[bagianKey];
          
          // Search in Bagian title
          if (searchInTitles && bagian.judul && 
              this.matchText(bagian.judul, term, { caseSensitive, exactMatch })) {
            results.push({
              type: 'bagian',
              babKey: babKey,
              key: bagianKey,
              title: bagian.judul,
              match: 'title',
              context: bagian.judul
            });
          }
          
          // Search in Pasal
          if (bagian.pasal) {
            Object.keys(bagian.pasal).forEach(pasalKey => {
              const pasal = bagian.pasal[pasalKey];
              this.searchInPasal(pasal, pasalKey, babKey, bagianKey, term, 
                               { caseSensitive, exactMatch, searchInContent }, results);
            });
          } else if (bagian.isi) {
            // Direct pasal in BAB
            this.searchInPasal(bagian, bagianKey, babKey, null, term,
                             { caseSensitive, exactMatch, searchInContent }, results);
          }
        });
      }
    });

    return results;
  }

  /**
   * Search within a specific pasal
   */
  static searchInPasal(pasal, pasalKey, babKey, bagianKey, term, options, results) {
    if (pasal.isi && Array.isArray(pasal.isi)) {
      pasal.isi.forEach((ayat, index) => {
        if (options.searchInContent && 
            this.matchText(ayat, term, { caseSensitive: options.caseSensitive, exactMatch: options.exactMatch })) {
          results.push({
            type: 'ayat',
            babKey: babKey,
            bagianKey: bagianKey,
            pasalKey: pasalKey,
            ayatIndex: index,
            title: `${pasalKey} Ayat ${index + 1}`,
            match: 'content',
            context: this.getContext(ayat, term, 50)
          });
        }
      });
    }
  }

  /**
   * Check if text matches search term
   */
  static matchText(text, term, options) {
    if (!text || !term) return false;
    
    const searchText = options.caseSensitive ? text : text.toLowerCase();
    const searchTerm = options.caseSensitive ? term : term.toLowerCase();
    
    if (options.exactMatch) {
      return searchText === searchTerm;
    } else {
      return searchText.includes(searchTerm);
    }
  }

  /**
   * Get context around the matched term
   */
  static getContext(text, term, contextLength = 50) {
    const lowerText = text.toLowerCase();
    const lowerTerm = term.toLowerCase();
    const index = lowerText.indexOf(lowerTerm);
    
    if (index === -1) return text;
    
    const start = Math.max(0, index - contextLength);
    const end = Math.min(text.length, index + term.length + contextLength);
    
    let context = text.substring(start, end);
    
    if (start > 0) context = '...' + context;
    if (end < text.length) context = context + '...';
    
    return context;
  }

  /**
   * Filter JSON data based on search criteria
   * @param {Object} jsonData - Original JSON data
   * @param {Object} filters - Filter criteria
   * @returns {Object} - Filtered JSON data
   */
  static filterJSON(jsonData, filters = {}) {
    const {
      babNumbers = [],
      bagianNumbers = [],
      pasalNumbers = []
    } = filters;

    const filteredData = {};

    Object.keys(jsonData).forEach(babKey => {
      const bab = jsonData[babKey];
      let shouldIncludeBab = true;

      // Filter by BAB numbers
      if (babNumbers.length > 0) {
        const babNumber = this.extractNumber(babKey);
        shouldIncludeBab = babNumbers.includes(babNumber);
      }

      if (shouldIncludeBab) {
        const filteredBab = { ...bab, bagian: {} };

        if (bab.bagian) {
          Object.keys(bab.bagian).forEach(bagianKey => {
            const bagian = bab.bagian[bagianKey];
            let shouldIncludeBagian = true;

            // Apply filters
            if (bagianNumbers.length > 0 && bagianKey !== 'PASAL_LANGSUNG') {
              const bagianNumber = this.extractNumber(bagianKey);
              shouldIncludeBagian = bagianNumbers.includes(bagianNumber);
            }

            if (shouldIncludeBagian) {
              filteredBab.bagian[bagianKey] = bagian;
            }
          });
        }

        if (Object.keys(filteredBab.bagian).length > 0) {
          filteredData[babKey] = filteredBab;
        }
      }
    });

    return filteredData;
  }

  /**
   * Extract number from key (e.g., "BAB_1" -> 1)
   */
  static extractNumber(key) {
    const match = key.match(/\d+/);
    return match ? parseInt(match[0]) : 0;
  }

  /**
   * Get statistics for filtered data
   */
  static getFilteredStats(filteredData) {
    const stats = {
      totalBab: Object.keys(filteredData).length,
      totalBagian: 0,
      totalPasal: 0,
      totalAyat: 0
    };

    Object.values(filteredData).forEach(bab => {
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
}

module.exports = DocumentManager;
