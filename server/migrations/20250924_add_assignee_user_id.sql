ALTER TABLE tasks ADD COLUMN assignee_user_id INT NULL AFTER created_by;
ALTER TABLE task_steps ADD COLUMN assignee_user_id INT NULL AFTER content;
