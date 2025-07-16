const LegalDocument = require('./LegalDocument');
const DocumentManager = require('./DocumentManager');

module.exports = {
  LegalDocument,
  DocumentManager,
  // Backward compatibility aliases
  PdfProcessor: LegalDocument,
  FileManager: DocumentManager,
  JsonFormatter: LegalDocument,
  SearchModel: DocumentManager
};
