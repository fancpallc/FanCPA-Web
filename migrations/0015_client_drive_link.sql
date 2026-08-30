-- Revision 2: Drive link is 1:1 with client email stored on contacts plus indexes for Drive-URL search
ALTER TABLE contacts ADD COLUMN drive_folder_id TEXT;
ALTER TABLE contacts ADD COLUMN drive_is_manual INTEGER DEFAULT 0;
CREATE INDEX idx_contacts_drive_folder_id ON contacts(drive_folder_id);
CREATE INDEX idx_cdf_folder_id ON client_drive_folders(folder_id);
CREATE INDEX idx_cdf_parent_folder_id ON client_drive_folders(parent_folder_id);
