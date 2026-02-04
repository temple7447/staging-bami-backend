const axios = require('axios');
const crypto = require('crypto');

/**
 * Paystack Payment Service
 * Handles all Paystack API integrations for payment processing
 * 
 * Paystack Docs: https://paystack.com/docs
 */

class PaystackService {
  constructor() {
    this.secretKey = process.env.PAYSTACK_SECRET_KEY;
    this.publicKey = process.env.PAYSTACK_PUBLIC_KEY;
    this.sandbox = process.env.PAYSTACK_SANDBOX === 'true';

    // API Endpoints
    this.baseUrl = 'https://api.paystack.co';
  }

  /**
   * Verify Paystack service is properly configured
   */
  isConfigured() {
    const required = ['secretKey', 'publicKey'];
    const missing = required.filter(key => !this[key]);

    if (missing.length > 0) {
      console.warn(`[PaystackService] Missing configuration: ${missing.join(', ')}`);
      return false;
    }
    return true;
  }

  /**
   * Generate unique reference for each payment
   */
  generateReference() {
    return `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Initialize payment with Paystack
   * @param {Object} paymentData - Payment details
   * @returns {Promise<Object>} - Paystack response with authorization URL
   */
  async initiatePayment(paymentData) {
    try {
      if (!this.isConfigured()) {
        throw new Error('Paystack service not properly configured');
      }

      const reference = paymentData.reference || this.generateReference();

      // Points to frontend dashboard success page. Explicitly appending reference parameters.
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
      const callbackUrl = paymentData.callbackUrl || `${frontendUrl}/dashboard/payment/success?trxref=${reference}&reference=${reference}`;

      const payload = {
        email: paymentData.customerEmail,
        amount: paymentData.amount * 100, // Paystack uses kobo (1 Naira = 100 kobo)
        reference: reference,
        callback_url: callbackUrl,
        metadata: {
          tenantId: paymentData.tenantId,
          estateId: paymentData.estateId,
          customerId: paymentData.customerId,
          description: paymentData.description,
          customerName: paymentData.customerName,
          customerPhone: paymentData.customerPhone,
          ...paymentData.metadata // Include any custom metadata
        }
      };

      console.log('[PaystackService] Initiating payment:', {
        reference: reference,
        amount: paymentData.amount,
        email: paymentData.customerEmail,
        customer: paymentData.customerName
      });

      // Make API request
      const response = await axios.post(
        `${this.baseUrl}/transaction/initialize`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      if (response.data.status === true) {
        console.log('[PaystackService] Payment initialized successfully:', response.data.data);
        return {
          success: true,
          reference: response.data.data.reference,
          authorizationUrl: response.data.data.authorization_url,
          accessCode: response.data.data.access_code,
          paystackPaymentId: response.data.data.reference,
          amount: paymentData.amount,
          rawResponse: response.data
        };
      } else {
        throw new Error(`Paystack error: ${response.data.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('[PaystackService] Payment initiation error:', error.message);
      return {
        success: false,
        error: error.message,
        errorCode: error.response?.data?.status
      };
    }
  }

  /**
   * Verify payment with Paystack
   * @param {String} reference - Payment reference
   * @returns {Promise<Object>} - Payment verification result
   */
  async verifyPayment(reference) {
    try {
      if (!this.isConfigured()) {
        throw new Error('Paystack service not properly configured');
      }

      console.log('[PaystackService] Verifying payment:', reference);

      const response = await axios.get(
        `${this.baseUrl}/transaction/verify/${reference}`,
        {
          headers: {
            'Authorization': `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      if (response.data.status === true) {
        const data = response.data.data;
        console.log('[PaystackService] Payment verified:', {
          status: data.status,
          amount: data.amount,
          reference: data.reference
        });

        return {
          success: true,
          status: data.status,
          amount: data.amount / 100, // Convert from kobo to Naira
          reference: data.reference,
          customer: {
            email: data.customer.email,
            name: data.metadata?.customerName || data.customer.customer_name,
            phone: data.metadata?.customerPhone
          },
          paidAt: data.paid_at,
          transactionId: data.id,
          authorizationCode: data.authorization.authorization_code,
          metadata: data.metadata,
          rawResponse: response.data
        };
      } else {
        throw new Error(`Paystack error: ${response.data.message}`);
      }
    } catch (error) {
      console.error('[PaystackService] Payment verification error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Refund a payment
   * @param {String} reference - Payment reference
   * @param {Number} amount - Refund amount in Naira (optional, full refund if not specified)
   * @returns {Promise<Object>} - Refund result
   */
  async refundPayment(reference, amount = null) {
    try {
      if (!this.isConfigured()) {
        throw new Error('Paystack service not properly configured');
      }

      const payload = {
        amount: amount ? amount * 100 : undefined // Convert to kobo if specified
      };

      // Remove amount if not specified (full refund)
      if (!amount) {
        delete payload.amount;
      }

      console.log('[PaystackService] Processing refund:', {
        reference: reference,
        amount: amount || 'full'
      });

      const response = await axios.post(
        `${this.baseUrl}/refund`,
        {
          transaction: reference,
          ...payload
        },
        {
          headers: {
            'Authorization': `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      if (response.data.status === true) {
        console.log('[PaystackService] Refund initiated:', response.data.data);
        return {
          success: true,
          refundReference: response.data.data.reference,
          status: response.data.data.status,
          amount: response.data.data.amount / 100,
          rawResponse: response.data
        };
      } else {
        throw new Error(`Paystack error: ${response.data.message}`);
      }
    } catch (error) {
      console.error('[PaystackService] Refund error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Verify webhook signature from Paystack
   * @param {Object} body - Request body
   * @param {String} signature - X-Paystack-Signature header
   * @returns {Boolean} - True if signature is valid
   */
  verifyWebhookSignature(body, signature) {
    try {
      const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
      const hash = crypto
        .createHmac('sha512', this.secretKey)
        .update(bodyString)
        .digest('hex');

      return hash === signature;
    } catch (error) {
      console.error('[PaystackService] Webhook signature verification error:', error);
      return false;
    }
  }

  /**
   * Get bank list from Paystack
   * @returns {Promise<Array>} - List of banks
   */
  async getBanks() {
    try {
      if (!this.isConfigured()) {
        throw new Error('Paystack service not properly configured');
      }

      const response = await axios.get(
        `${this.baseUrl}/bank`,
        {
          headers: {
            'Authorization': `Bearer ${this.secretKey}`
          },
          timeout: 10000
        }
      );

      if (response.data.status === true) {
        return {
          success: true,
          banks: response.data.data
        };
      } else {
        throw new Error(response.data.message);
      }
    } catch (error) {
      console.error('[PaystackService] Get banks error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Format amount to Naira currency
   */
  formatAmount(amount) {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN'
    }).format(amount);
  }
}

module.exports = new PaystackService();
