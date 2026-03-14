import React, { useEffect, useMemo, useState } from 'react';
import {
  Users,
  MessageSquareText,
  UserCheck,
  MessagesSquare,
} from 'lucide-react';
import {
  addGroupMembers,
  createGroup,
  getAdminOverview,
  getGroups,
  sendGroupMessage,
} from '../../lib/api';

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '-';

const normalizePhones = (input) =>
  input
    .split(',')
    .map((phone) => phone.trim())
    .filter(Boolean);

const Dashboard = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState(null);
  const [groups, setGroups] = useState([]);

  const [createForm, setCreateForm] = useState({
    name: '',
    ownerPhone: '',
    ownerName: '',
    memberPhones: '',
  });
  const [addMembersForm, setAddMembersForm] = useState({
    groupId: '',
    memberPhones: '',
  });
  const [messageForm, setMessageForm] = useState({
    groupId: '',
    body: '',
    senderPhone: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [actionFeedback, setActionFeedback] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');

    try {
      const [overviewData, groupsData] = await Promise.all([
        getAdminOverview(),
        getGroups(),
      ]);
      setOverview(overviewData);
      setGroups(groupsData);
      setActionFeedback('');
    } catch (err) {
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!groups.length) {
      return;
    }

    setAddMembersForm((prev) => ({
      ...prev,
      groupId: prev.groupId || groups[0].id,
    }));
    setMessageForm((prev) => ({
      ...prev,
      groupId: prev.groupId || groups[0].id,
    }));
  }, [groups]);

  const metrics = useMemo(() => {
    const values = overview?.metrics ?? {};
    return [
      {
        title: 'Total Users',
        value: values.totalUsers ?? 0,
        icon: <Users size={28} />,
        bg: '#e0e7ff',
        color: '#4f46e5',
      },
      {
        title: 'WhatsApp Groups',
        value: values.totalGroups ?? 0,
        icon: <MessagesSquare size={28} />,
        bg: '#dcfce7',
        color: '#16a34a',
      },
      {
        title: 'Total Messages',
        value: values.totalMessages ?? 0,
        icon: <MessageSquareText size={28} />,
        bg: '#fef3c7',
        color: '#d97706',
      },
      {
        title: 'Active Members',
        value: values.activeMembers ?? 0,
        icon: <UserCheck size={28} />,
        bg: '#fee2e2',
        color: '#dc2626',
      },
    ];
  }, [overview]);

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setActionFeedback('');
    try {
      const result = await createGroup(
        createForm.name.trim(),
        createForm.ownerPhone.trim() || undefined,
        createForm.ownerName.trim() || undefined,
        normalizePhones(createForm.memberPhones),
      );
      setActionFeedback(
        `Group "${result.name}" created. Join code: ${result.joinCode}.`,
      );
      setCreateForm({ name: '', ownerPhone: '', ownerName: '', memberPhones: '' });
      await loadData();
    } catch (err) {
      setActionFeedback(err.message || 'Failed to create group');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddMembers = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setActionFeedback('');
    try {
      const result = await addGroupMembers(
        addMembersForm.groupId,
        normalizePhones(addMembersForm.memberPhones),
      );
      setActionFeedback(
        `Added ${result.added} member(s). Invites sent: ${result.invitesSent}.`,
      );
      setAddMembersForm((prev) => ({ ...prev, memberPhones: '' }));
      await loadData();
    } catch (err) {
      setActionFeedback(err.message || 'Failed to add members');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setActionFeedback('');
    try {
      await sendGroupMessage(
        messageForm.groupId,
        messageForm.body.trim(),
        messageForm.senderPhone.trim() || undefined,
      );
      setActionFeedback('Message sent to the selected group.');
      setMessageForm((prev) => ({ ...prev, body: '' }));
      await loadData();
    } catch (err) {
      setActionFeedback(err.message || 'Failed to send message');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="admin-card">Loading WhatsApp/Postgres data...</div>;
  }

  return (
    <div>
      {error && <div className="admin-alert admin-alert-error">{error}</div>}
      {actionFeedback && <div className="admin-alert admin-alert-info">{actionFeedback}</div>}

      <div className="admin-card-header">
        <h3>Live WhatsApp Overview</h3>
      </div>

      <div className="dashboard-metrics">
        {metrics.map((m) => (
          <div key={m.title} className="metric-card">
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

      <div className="admin-grid admin-grid-3">
        <div className="admin-card">
          <h3>Create WhatsApp Group</h3>
          <form onSubmit={handleCreateGroup} className="admin-form">
            <input
              value={createForm.name}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Group name"
              required
            />
            <input
              value={createForm.ownerPhone}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, ownerPhone: e.target.value }))}
              placeholder="Owner phone (+15551234567)"
            />
            <input
              value={createForm.ownerName}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, ownerName: e.target.value }))}
              placeholder="Owner display name (optional)"
            />
            <textarea
              value={createForm.memberPhones}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, memberPhones: e.target.value }))}
              placeholder="Member phones, comma separated"
              rows={3}
            />
            <button type="submit" disabled={submitting}>Create Group</button>
          </form>
        </div>

        <div className="admin-card">
          <h3>Add Members</h3>
          <form onSubmit={handleAddMembers} className="admin-form">
            <select
              value={addMembersForm.groupId}
              onChange={(e) => setAddMembersForm((prev) => ({ ...prev, groupId: e.target.value }))}
              required
            >
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name} ({group.joinCode})
                </option>
              ))}
            </select>
            <textarea
              value={addMembersForm.memberPhones}
              onChange={(e) => setAddMembersForm((prev) => ({ ...prev, memberPhones: e.target.value }))}
              placeholder="Phones, comma separated"
              rows={4}
              required
            />
            <button type="submit" disabled={submitting || groups.length === 0}>Add Members</button>
          </form>
        </div>

        <div className="admin-card">
          <h3>Send Group Message</h3>
          <form onSubmit={handleSendMessage} className="admin-form">
            <select
              value={messageForm.groupId}
              onChange={(e) => setMessageForm((prev) => ({ ...prev, groupId: e.target.value }))}
              required
            >
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name} ({group.joinCode})
                </option>
              ))}
            </select>
            <input
              value={messageForm.senderPhone}
              onChange={(e) => setMessageForm((prev) => ({ ...prev, senderPhone: e.target.value }))}
              placeholder="Sender phone (+15551234567, optional)"
            />
            <textarea
              value={messageForm.body}
              onChange={(e) => setMessageForm((prev) => ({ ...prev, body: e.target.value }))}
              placeholder="Message body"
              rows={4}
              required
            />
            <button type="submit" disabled={submitting || groups.length === 0}>Send Message</button>
          </form>
        </div>
      </div>

      <div className="admin-grid">
        <div className="admin-card">
          <div className="admin-card-header">
            <h3>Recent Users (Postgres)</h3>
          </div>
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Phone Number</th>
                  <th>Name</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.recentUsers ?? []).map((user) => (
                  <tr key={user.id}>
                    <td style={{ fontWeight: 500 }}>{user.phone}</td>
                    <td>{user.name || '-'}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{formatDate(user.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="admin-card">
          <div className="admin-card-header">
            <h3>Recent Group Messages</h3>
          </div>
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Sender</th>
                  <th>Body</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.recentMessages ?? []).map((message) => (
                  <tr key={message.id}>
                    <td>{message.group?.name || '-'}</td>
                    <td>{message.senderUser?.name || message.senderPhone}</td>
                    <td>{message.body}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{formatDate(message.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="admin-card">
          <div className="admin-card-header">
            <h3>Recent Groups</h3>
          </div>
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Join Code</th>
                  <th>Members</th>
                  <th>Messages</th>
                  <th>Latest</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.recentGroups ?? []).map((group) => (
                  <tr key={group.id}>
                    <td>{group.name}</td>
                    <td style={{ fontWeight: 600 }}>{group.joinCode}</td>
                    <td>{group.activeMembersCount}/{group.membersCount}</td>
                    <td>{group.messagesCount}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>
                      {group.latestMessage ? formatDate(group.latestMessage.createdAt) : '-'}
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
