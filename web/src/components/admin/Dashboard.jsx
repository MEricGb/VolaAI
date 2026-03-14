import React from 'react';
import { Users, MessageSquareText, Image as ImageIcon, CreditCard, ChevronRight } from 'lucide-react';

const Dashboard = () => {
  // Mock data as requested
  const metrics = [
    { title: "Total Users", value: "1,248", icon: <Users size={28} />, bg: "#e0e7ff", color: "#4f46e5" },
    { title: "Total Convs", value: "5,832", icon: <MessageSquareText size={28} />, bg: "#dcfce7", color: "#16a34a" },
    { title: "Total Images", value: "840", icon: <ImageIcon size={28} />, bg: "#fef3c7", color: "#d97706" },
    { title: "Payments", value: "€124,500", icon: <CreditCard size={28} />, bg: "#fee2e2", color: "#dc2626" },
  ];

  const recentUsers = [
    { phone: "+40 722 123 456", name: "Alexandru Popescu", date: "Today, 10:42 AM", status: "Active" },
    { phone: "+44 7911 123456", name: "Sarah Jenkins", date: "Today, 09:15 AM", status: "Active" },
    { phone: "+40 755 987 654", name: "Maria Ionescu", date: "Yesterday", status: "Inactive" },
    { phone: "+39 342 123 4567", name: "Marco Rossi", date: "Yesterday", status: "Active" },
  ];

  const recentTransactions = [
    { id: "TRX-8921", user: "Alexandru Popescu", amount: "€340.00", dest: "Rome (FCO)", status: "Completed" },
    { id: "TRX-8920", user: "Sarah Jenkins", amount: "€850.00", dest: "Dubai (DXB)", status: "Processing" },
    { id: "TRX-8919", user: "Ionela Stan", amount: "€125.00", dest: "London (LTN)", status: "Completed" },
  ];

  return (
    <div>
      {/* Metrics Section */}
      <div className="dashboard-metrics">
        {metrics.map((m, i) => (
          <div key={i} className="metric-card">
            <div className="metric-icon" style={{ backgroundColor: m.bg, color: m.color }}>
              {m.icon}
            </div>
            <div className="metric-info">
              <h3>{m.title}</h3>
              <p>{m.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tables Section */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem' }}>
        
        {/* Users Table */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h3>Recent Users</h3>
            <button className="btn btn-primary" style={{ padding: '0.4rem 1rem', fontSize: '0.875rem' }}>View All</button>
          </div>
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Phone Number</th>
                  <th>Name</th>
                  <th>Joined Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentUsers.map((u, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{u.phone}</td>
                    <td>{u.name}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{u.date}</td>
                    <td>
                      <span className={`badge ${u.status === 'Active' ? 'badge-success' : 'badge-warning'}`}>
                        {u.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Transactions Table */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h3>Recent Payments</h3>
            <button className="btn btn-primary" style={{ padding: '0.4rem 1rem', fontSize: '0.875rem' }}>View All</button>
          </div>
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Transaction ID</th>
                  <th>User</th>
                  <th>Destination</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentTransactions.map((t, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500, color: 'var(--color-primary)' }}>{t.id}</td>
                    <td>{t.user}</td>
                    <td>{t.dest}</td>
                    <td style={{ fontWeight: 600 }}>{t.amount}</td>
                    <td>
                      <span className={`badge ${t.status === 'Completed' ? 'badge-success' : 'badge-blue'}`}>
                        {t.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
};

export default Dashboard;
