const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'BamiHustle Backend API',
      version: '1.0.0',
      description: 'Comprehensive property management backend system with payment processing, unit management, tenant tracking, and wallet distribution.',
      contact: {
        name: 'BamiHustle Support',
        email: 'support@bamihustle.com'
      },
      license: {
        name: 'MIT'
      }
    },
    servers: [
      {
        url: 'http://localhost:5000',
        description: 'Development Server'
      },
      {
        url: 'https://bamihost.com',
        description: 'Production Server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            message: {
              type: 'string'
            },
            error: {
              type: 'string'
            }
          }
        },
        Unit: {
          type: 'object',
          properties: {
            unitId: {
              type: 'string',
              description: 'Unit MongoDB ID'
            },
            label: {
              type: 'string',
              example: 'Unit 1'
            },
            monthlyPrice: {
              type: 'number',
              example: 40000
            },
            meterNumber: {
              type: 'string',
              example: 'EN-12232323'
            },
            description: {
              type: 'string'
            },
            status: {
              type: 'string',
              enum: ['vacant', 'occupied', 'maintenance', 'reserved']
            },
            features: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  value: { type: 'string' }
                }
              }
            }
          }
        },
        Tenant: {
          type: 'object',
          properties: {
            tenantId: {
              type: 'string'
            },
            tenantName: {
              type: 'string'
            },
            tenantEmail: {
              type: 'string'
            },
            tenantPhone: {
              type: 'string'
            },
            rentAmount: {
              type: 'number'
            },
            status: {
              type: 'string',
              enum: ['occupied', 'vacant', 'pending', 'evicted']
            },
            unit: {
              type: 'object',
              properties: {
                unitId: { type: 'string' },
                label: { type: 'string' }
              }
            }
          }
        },
        WalletBalance: {
          type: 'object',
          properties: {
            estateId: {
              type: 'string'
            },
            marketing: {
              type: 'object',
              properties: {
                balance: { type: 'number' },
                percentage: { type: 'number', example: 50 }
              }
            },
            owner: {
              type: 'object',
              properties: {
                balance: { type: 'number' },
                percentage: { type: 'number', example: 30 }
              }
            },
            operations: {
              type: 'object',
              properties: {
                balance: { type: 'number' },
                percentage: { type: 'number', example: 20 }
              }
            },
            totalBalance: {
              type: 'number'
            },
            totalReceived: {
              type: 'number'
            }
          }
        },
        Payment: {
          type: 'object',
          properties: {
            paymentId: {
              type: 'string'
            },
            amount: {
              type: 'number'
            },
            paymentType: {
              type: 'string',
              enum: ['deposit', 'rent', 'service_charge', 'caution_fee', 'legal_fee']
            },
            status: {
              type: 'string',
              enum: ['pending', 'initiated', 'completed', 'failed', 'refunded']
            },
            tenant: {
              type: 'object'
            },
            estate: {
              type: 'object'
            }
          }
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ]
  },
  apis: [
    './config/swagger-complete.js',
    './routes/auth.js',
    './routes/estates.js',
    './routes/units.js',
    './routes/tenants.js',
    './routes/payments.js',
    './routes/distribution.js',
    './routes/wallet.js',
    './routes/upload.js'
  ]
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
