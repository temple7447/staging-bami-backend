// Frontend Integration Examples for Unified Dashboard Endpoint

// ============================================
// 1. REACT HOOK (Recommended)
// ============================================

import { useEffect, useState } from 'react';
import axios from 'axios';

const useDashboardOverview = () => {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchOverview = async () => {
      try {
        const token = localStorage.getItem('authToken');
        
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/api/dashboard/overview`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          }
        );

        if (response.data.success) {
          setOverview(response.data.data);
          setError(null);
        } else {
          setError(response.data.message);
        }
      } catch (err) {
        setError(err.message || 'Failed to fetch overview');
        console.error('Dashboard error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchOverview();
  }, []);

  return { overview, loading, error };
};

// Usage in Component
export const DashboardPage = () => {
  const { overview, loading, error } = useDashboardOverview();

  if (loading) return <div>Loading dashboard...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="dashboard">
      <h1>Welcome, {overview.user.name}!</h1>
      
      {overview.role === 'tenant' && <TenantDashboard data={overview.data} />}
      {overview.role === 'business_owner' && <BusinessOwnerDashboard data={overview.data} />}
      {overview.role === 'vendor' && <VendorDashboard data={overview.data} />}
      {overview.role === 'super_admin' && <AdminDashboard data={overview.data} />}
    </div>
  );
};

// ============================================
// 2. TENANT DASHBOARD COMPONENT
// ============================================

const TenantDashboard = ({ data }) => {
  const { apartment, billing, payments, wallet, notifications } = data;

  return (
    <div className="tenant-overview">
      {/* Apartment Card */}
      <section className="apartment-section">
        <h2>Your Apartment</h2>
        <div className="card">
          <p><strong>Unit:</strong> {apartment.unit}</p>
          <p><strong>Estate:</strong> {apartment.estate}</p>
          <p><strong>Rent:</strong> ₦{apartment.rentAmount.toLocaleString()}</p>
          <p><strong>Status:</strong> {apartment.status}</p>
          <p><strong>Entry Date:</strong> {new Date(apartment.entryDate).toLocaleDateString()}</p>
          <p><strong>Next Due:</strong> {new Date(apartment.nextDueDate).toLocaleDateString()}</p>
        </div>
      </section>

      {/* Financial Summary */}
      <section className="financial-section">
        <h2>Financial Summary</h2>
        <div className="cards-grid">
          {/* Pending Bills Card */}
          <div className="card">
            <h3>Pending Bills</h3>
            <p className="amount">₦{billing.totalPending.toLocaleString()}</p>
            <p className="subtitle">{billing.overdue.length} overdue</p>
          </div>

          {/* Total Paid Card */}
          <div className="card">
            <h3>Total Paid</h3>
            <p className="amount success">₦{billing.totalPaid.toLocaleString()}</p>
            <p className="subtitle">{payments.recentPayments.length} recent</p>
          </div>

          {/* Wallet Balance Card */}
          <div className="card">
            <h3>Wallet Balance</h3>
            <p className="amount">₦{wallet.balance.toLocaleString()}</p>
            <p className="subtitle">{wallet.currency}</p>
          </div>
        </div>
      </section>

      {/* Overdue Items */}
      {billing.overdue.length > 0 && (
        <section className="overdue-section">
          <h2>⚠️ Overdue Items</h2>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Amount</th>
                <th>Days Overdue</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {billing.overdue.map(item => (
                <tr key={item.id} className="overdue-row">
                  <td>{item.label}</td>
                  <td>₦{item.amount.toLocaleString()}</td>
                  <td>{item.daysOverdue} days</td>
                  <td>
                    <button className="btn-pay">Pay Now</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Upcoming Due */}
      {billing.upcomingDue.length > 0 && (
        <section className="upcoming-section">
          <h2>📅 Upcoming Due</h2>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Amount</th>
                <th>Due Date</th>
                <th>Days Left</th>
              </tr>
            </thead>
            <tbody>
              {billing.upcomingDue.map(item => {
                const daysLeft = Math.ceil(
                  (new Date(item.dueDate) - new Date()) / (1000 * 60 * 60 * 24)
                );
                return (
                  <tr key={item.id}>
                    <td>{item.label}</td>
                    <td>₦{item.amount.toLocaleString()}</td>
                    <td>{new Date(item.dueDate).toLocaleDateString()}</td>
                    <td>{daysLeft} days</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* Recent Payments */}
      <section className="recent-payments-section">
        <h2>Recent Payments</h2>
        <div className="payment-list">
          {payments.recentPayments.map(payment => (
            <div key={payment.id} className="payment-item">
              <span className="payment-label">{payment.label}</span>
              <span className="payment-amount">₦{payment.amount.toLocaleString()}</span>
              <span className="payment-date">
                {new Date(payment.date).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Notifications */}
      {notifications.length > 0 && (
        <section className="notifications-section">
          <h2>Notifications ({notifications.length})</h2>
          <div className="notification-list">
            {notifications.map(notif => (
              <div key={notif.id} className="notification-item">
                <h4>{notif.title}</h4>
                <p>{notif.message}</p>
                <span className="time">
                  {new Date(notif.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

// ============================================
// 3. BUSINESS OWNER DASHBOARD COMPONENT
// ============================================

const BusinessOwnerDashboard = ({ data }) => {
  const { estates, statistics, recentPayments } = data;

  return (
    <div className="business-owner-overview">
      {/* Key Statistics */}
      <section className="stats-grid">
        <div className="stat-card">
          <h3>Total Estates</h3>
          <p className="stat-value">{statistics.totalEstates}</p>
        </div>
        <div className="stat-card">
          <h3>Total Units</h3>
          <p className="stat-value">{statistics.totalUnits}</p>
        </div>
        <div className="stat-card">
          <h3>Occupancy Rate</h3>
          <p className="stat-value">{statistics.occupancyRate}%</p>
        </div>
        <div className="stat-card">
          <h3>Total Revenue</h3>
          <p className="stat-value">₦{(statistics.totalRevenueGenerated / 1000000).toFixed(1)}M</p>
        </div>
        <div className="stat-card alert">
          <h3>Pending Payments</h3>
          <p className="stat-value">₦{(statistics.pendingPayments / 1000).toFixed(0)}K</p>
        </div>
      </section>

      {/* Estates Overview */}
      <section className="estates-section">
        <h2>Your Estates</h2>
        <div className="estates-grid">
          {estates.map(estate => (
            <div key={estate.id} className="estate-card">
              <h3>{estate.name}</h3>
              <p className="address">{estate.address}</p>
              <div className="estate-stats">
                <div>
                  <span className="label">Units:</span>
                  <span className="value">{estate.totalUnits}</span>
                </div>
                <div>
                  <span className="label">Occupied:</span>
                  <span className="value">{estate.occupiedUnits}</span>
                </div>
                <div>
                  <span className="label">Vacant:</span>
                  <span className="value">{estate.vacantUnits}</span>
                </div>
                <div>
                  <span className="label">Revenue:</span>
                  <span className="value success">₦{(estate.revenue / 1000000).toFixed(2)}M</span>
                </div>
                <div>
                  <span className="label">Pending:</span>
                  <span className="value alert">₦{(estate.pendingPayments / 1000).toFixed(0)}K</span>
                </div>
              </div>
              <button className="btn-view">View Details</button>
            </div>
          ))}
        </div>
      </section>

      {/* Recent Payments */}
      <section className="recent-payments">
        <h2>Recent Payments</h2>
        <table>
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Amount</th>
              <th>Type</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {recentPayments.map(payment => (
              <tr key={payment.id}>
                <td>{payment.tenantName}</td>
                <td>₦{payment.amount.toLocaleString()}</td>
                <td>{payment.paymentType}</td>
                <td>{new Date(payment.date).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
};

// ============================================
// 4. VENDOR DASHBOARD COMPONENT
// ============================================

const VendorDashboard = ({ data }) => {
  const { businessInfo, statistics, recentRequests, wallet } = data;

  return (
    <div className="vendor-overview">
      <section className="business-info">
        <h2>{businessInfo.businessName}</h2>
        <p>Specialization: {businessInfo.specialization}</p>
      </section>

      <section className="work-stats">
        <div className="stat-card">
          <h3>Total Requests</h3>
          <p className="stat-value">{statistics.totalRequests}</p>
        </div>
        <div className="stat-card success">
          <h3>Completed</h3>
          <p className="stat-value">{statistics.completedRequests}</p>
        </div>
        <div className="stat-card warning">
          <h3>In Progress</h3>
          <p className="stat-value">{statistics.inProgressRequests}</p>
        </div>
        <div className="stat-card">
          <h3>Pending</h3>
          <p className="stat-value">{statistics.pendingRequests}</p>
        </div>
        <div className="stat-card success">
          <h3>Earnings</h3>
          <p className="stat-value">₦{(statistics.totalEarnings / 1000).toFixed(0)}K</p>
        </div>
      </section>

      <section className="recent-requests">
        <h2>Recent Requests</h2>
        {recentRequests.map(request => (
          <div key={request.id} className="request-item">
            <h4>{request.title}</h4>
            <p>{request.description}</p>
            <div className="request-meta">
              <span className={`status ${request.status}`}>{request.status}</span>
              <span className={`priority ${request.priority}`}>{request.priority}</span>
              <span className="budget">₦{request.estimatedBudget.toLocaleString()}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="wallet-info">
        <h2>Wallet</h2>
        <div className="cards-grid">
          <div className="card">
            <h3>Balance</h3>
            <p className="amount">₦{wallet.balance.toLocaleString()}</p>
          </div>
          <div className="card">
            <h3>Total Earnings</h3>
            <p className="amount success">₦{wallet.totalEarnings.toLocaleString()}</p>
          </div>
        </div>
      </section>
    </div>
  );
};

// ============================================
// 5. ADMIN DASHBOARD COMPONENT
// ============================================

const AdminDashboard = ({ data }) => {
  const { statistics, userDistribution } = data;

  return (
    <div className="admin-overview">
      <h1>System Overview</h1>

      <section className="system-stats">
        <div className="stat-card">
          <h3>Total Users</h3>
          <p className="stat-value">{statistics.totalUsers.toLocaleString()}</p>
        </div>
        <div className="stat-card">
          <h3>Total Estates</h3>
          <p className="stat-value">{statistics.totalEstates}</p>
        </div>
        <div className="stat-card">
          <h3>Total Tenants</h3>
          <p className="stat-value">{statistics.totalTenants.toLocaleString()}</p>
        </div>
        <div className="stat-card">
          <h3>Platform Revenue</h3>
          <p className="stat-value">₦{(statistics.systemRevenue / 1000000).toFixed(1)}M</p>
        </div>
      </section>

      <section className="user-distribution">
        <h2>User Distribution</h2>
        <div className="distribution-list">
          {Object.entries(userDistribution).map(([role, count]) => (
            <div key={role} className="distribution-item">
              <span className="role">{role}</span>
              <span className="count">{count}</span>
              <div className="bar" style={{width: `${(count / statistics.totalUsers) * 100}%`}}></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default {
  useDashboardOverview,
  TenantDashboard,
  BusinessOwnerDashboard,
  VendorDashboard,
  AdminDashboard,
  DashboardPage
};
