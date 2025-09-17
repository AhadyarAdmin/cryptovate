const kycService = require('../services/kyc.service');
const multer = require('multer');
const path = require('path');

// Multer-Konfiguration für Datei-Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(process.env.UPLOAD_PATH, 'documents'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${req.user.id}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG and PDF files are allowed'));
    }
  }
});

class KYCController {
  // KYC-Dokumente hochladen
  async uploadDocuments(req, res) {
    try {
      const uploadFields = upload.fields([
        { name: 'documentFront', maxCount: 1 },
        { name: 'documentBack', maxCount: 1 },
        { name: 'selfie', maxCount: 1 }
      ]);

      uploadFields(req, res, async (err) => {
        if (err) {
          return res.status(400).json({
            success: false,
            error: err.message
          });
        }

        const { documentType, documentNumber } = req.body;
        const userId = req.user.id;

        if (!req.files.documentFront || !req.files.selfie) {
          return res.status(400).json({
            success: false,
            error: 'Document front and selfie are required'
          });
        }

        const kycData = {
          documentType,
          documentNumber,
          documentFrontUrl: `/uploads/documents/${req.files.documentFront[0].filename}`,
          documentBackUrl: req.files.documentBack ? `/uploads/documents/${req.files.documentBack[0].filename}` : null,
          selfieUrl: `/uploads/documents/${req.files.selfie[0].filename}`
        };

        try {
          const result = await kycService.submitKYCData(userId, kycData);
          
          res.status(200).json({
            success: true,
            message: 'KYC documents uploaded successfully',
            data: {
              kycId: result.kycId,
              status: 'pending'
            }
          });
        } catch (kycError) {
          console.error('KYC submission failed:', kycError);
          res.status(500).json({
            success: false,
            error: 'KYC submission failed'
          });
        }
      });
    } catch (error) {
      console.error('KYC upload failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to upload KYC documents'
      });
    }
  }

  // KYC-Status abrufen
  async getKYCStatus(req, res) {
    try {
      const userId = req.user.id;
      const result = await kycService.getKYCStatus(userId);

      res.status(200).json({
        success: true,
        data: result.data || { status: 'not_submitted' }
      });
    } catch (error) {
      console.error('Get KYC status failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get KYC status'
      });
    }
  }
}

module.exports = new KYCController();
