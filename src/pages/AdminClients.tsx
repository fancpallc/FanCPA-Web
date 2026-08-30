import React, { useState, useEffect } from 'react';
import { useAdminAuth } from '../hooks/useAdminAuth';
import { searchAdminClients, updateAdminDriveFolder, sendAdminClientEmail, AdminClientRow } from '../lib/api';
import { toast } from 'react-hot-toast';
import { Link } from 'react-router-dom';

export default function AdminClients() {
  const { isAuthed, loading: authLoading } = useAdminAuth();
  const [q, setQ] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [results, setResults] = useState<AdminClientRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [newBooking, setNewBooking] = useState({ first_name: '', last_name: '', email: '', phone: '', purpose: '', slot_start: '', slot_end: '', sendEmail: false });
  const [deleteTarget, setDeleteTarget] = useState<AdminClientRow | null>(null);
  const [cancelMeetingChecked, setCancelMeetingChecked] = useState(true);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setLoading(true);
    try {
      const data = await searchAdminClients(q, { startDate, endDate });
      setResults(data);
    } catch (err: any) {
      toast.error('Search failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };


  const handleSave = async (contact_id: string, year: number | undefined) => {
    const url = editing[contact_id];
    if (!url) return;
    try {
      if (!year) throw new Error("Year missing");
      await updateAdminDriveFolder(contact_id, year.toString(), url);
      toast.success('Drive link updated');
      handleSearch();
    } catch (err: any) {
      toast.error('Failed to save: ' + err.message);
    }
  };

  const handleSend = async (contact_id: string) => {
    try {
      await sendAdminClientEmail(contact_id);
      toast.success('Email sent');
    } catch (err: any) {
      toast.error('Failed to send: ' + err.message);
    }
  };

  if (authLoading) return <div>Loading...</div>;
  if (!isAuthed) return <div>Unauthorized</div>;

  return (
    <div className="p-4">
      <div className="sticky top-0 bg-white p-4 border-b flex justify-between items-center z-10">
        <h1 className="text-xl font-bold">Admin Client Portal</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowAddModal(true)} className="bg-blue-600 text-white px-4 py-1 rounded">+ Add Booking</button>
          <button onClick={() => window.location.href = '/admin'} className="text-blue-600">Back to Admin</button>
          <a href="/" className="text-blue-600">View site</a>
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
          <div className="bg-white p-6 rounded shadow w-full max-w-md">
            <h2 className="text-lg font-bold mb-4">Add Booking</h2>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <input placeholder="First" className="border p-1" onChange={e => setNewBooking({...newBooking, first_name: e.target.value})} />
              <input placeholder="Last" className="border p-1" onChange={e => setNewBooking({...newBooking, last_name: e.target.value})} />
              <input placeholder="Email" className="border p-1 col-span-2" onChange={e => setNewBooking({...newBooking, email: e.target.value})} />
              <input placeholder="Phone" className="border p-1 col-span-2" onChange={e => setNewBooking({...newBooking, phone: e.target.value})} />
              <input placeholder="Purpose" className="border p-1 col-span-2" onChange={e => setNewBooking({...newBooking, purpose: e.target.value})} />
              <label className="text-xs">Start</label><input type="datetime-local" className="border p-1" onChange={e => setNewBooking({...newBooking, slot_start: e.target.value})} />
              <label className="text-xs">End</label><input type="datetime-local" className="border p-1" onChange={e => setNewBooking({...newBooking, slot_end: e.target.value})} />
              <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" onChange={e => setNewBooking({...newBooking, sendEmail: e.target.checked})} /> Send Confirmation Email</label>
            </div>
            <p className="text-xs text-gray-500 mb-4">GDrive auto generated based on email+year, Meet auto generated from time</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAddModal(false)} className="px-4 py-1">Cancel</button>
              
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
          <div className="bg-white p-6 rounded shadow w-full max-w-md">
            <h2 className="text-lg font-bold mb-4">Confirm Delete</h2>
            <p className="mb-4">Delete booking for {deleteTarget.first_name} {deleteTarget.last_name} at {deleteTarget.slot_start ? new Date(deleteTarget.slot_start).toLocaleString() : 'N/A'}? Drive folder will NOT be deleted.</p>
            <label className="flex items-center gap-2 mb-4">
              <input type="checkbox" checked={cancelMeetingChecked} onChange={e => setCancelMeetingChecked(e.target.checked)} />
              Also cancel meeting and free calendar?
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-1">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSearch} className="my-4 p-4 border rounded flex gap-2 items-end">
        <div>
          <label htmlFor="q" className="block text-sm">Search</label>
          <input id="q" value={q} onChange={e => setQ(e.target.value)} placeholder="Email, first or last name" className="border p-1" />
        </div>
        <div>
          <label htmlFor="startDate" className="block text-sm">From</label>
          <input id="startDate" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="border p-1" />
        </div>
        <div>
          <label htmlFor="endDate" className="block text-sm">To</label>
          <input id="endDate" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="border p-1" />
        </div>
        <button type="submit" disabled={loading} className="bg-blue-600 text-white px-4 py-1 rounded">Search</button>
      </form>

      <div className="text-sm mb-4">Effective Drive Root: Configured via Cloudflare env GOOGLE_DRIVE_ROOT_FOLDER_ID</div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="p-2">Name</th>
            <th className="p-2">Email</th>
            <th className="p-2">Meeting Time</th>
            <th className="p-2">Purpose</th>
            <th className="p-2">Timezone</th>
            <th className="p-2">Meeting URL</th>
            <th className="p-2">GDrive Link</th>
            <th className="p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {results.map(r => (
            <tr key={`${r.contact_id}-${r.booking_id || 'no-booking'}`} className="border-b">
              <td className="p-2">{r.first_name} {r.last_name}</td>
              <td className="p-2">{r.email}</td>
              <td className="p-2">{r.slot_start ? new Date(r.slot_start).toLocaleString() : '-'}</td>
              <td className="p-2">{r.purpose}</td>
              <td className="p-2">{r.time_zone}</td>
              <td className="p-2 text-xs truncate max-w-[100px]">{r.meet_link}</td>
              <td className="p-2">
                <input 
                  value={editing[r.contact_id] !== undefined ? editing[r.contact_id] : (r.year_folder_url || '')}
                  onChange={e => setEditing({...editing, [r.contact_id]: e.target.value})}
                  className="border p-1 w-full"
                />
                <button onClick={() => handleSave(r.contact_id, r.year || new Date().getFullYear())} className="text-blue-600 ml-1">Save</button>
              </td>
              <td className="p-2">
                <button onClick={() => handleSend(r.contact_id)} className="bg-green-600 text-white px-2 py-1 rounded">Send</button>
                {r.booking_id && (
                  <button onClick={() => setDeleteTarget(r)} className="bg-red-600 text-white px-2 py-1 rounded ml-1">Delete</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

