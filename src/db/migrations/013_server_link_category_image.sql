-- Optional banner of a category, shown in its embed when the mosaic of logos is off
ALTER TABLE server_link_categories ADD COLUMN IF NOT EXISTS image_url TEXT;
