-- Demo data for local testing only (placeholder names). The real import comes from the Carta export.
INSERT INTO settings (key, value) VALUES
 ('company_legal_name','Example Co, Inc.'),
 ('wire_instructions','Bank: (set in Settings)\nAccount name: Example Co, Inc.\nRouting: XXXXXXXXX\nAccount: XXXXXXXXXX\nMemo: your reference code'),
 ('controller_email','controller@example.com');

INSERT INTO stock_classes (id, name, prefix, authorized, is_preferred, conversion_ratio) VALUES
 (1,'Common','CS',10000000,0,1),(2,'Series A Preferred','PA',250000,1,1);
INSERT INTO plans (id, name, reserved, class_id, board_approval_date) VALUES (1,'2015 Equity Incentive Plan',1000000,1,'2015-03-01');

INSERT INTO stakeholders (id, name, email, relationship, termination_date) VALUES
 (1,'Demo Founder','you@example.com','Founder',NULL),
 (2,'Demo Cofounder','cofounder@example.com','Employee',NULL),
 (3,'Demo Investor','investor@example.com','Investor',NULL),
 (4,'Demo Employee','employee@example.com','Employee',NULL),
 (5,'Demo Ex-Employee','former@example.com','Ex-Employee','2026-09-20');

INSERT INTO securities (label, kind, stakeholder_id, class_id, quantity, price, issue_date, status) VALUES
 ('CS-1','share',1,1,4000000,0.0001,'2010-12-17','outstanding'),
 ('CS-2','share',2,1,1000000,0.0001,'2010-12-17','outstanding'),
 ('PA-1','share',3,2,250000,0.50,'2011-03-21','outstanding');

INSERT INTO securities (label, kind, stakeholder_id, plan_id, quantity, issue_date, option_type, exercise_price, expiration_date, vest_months, cliff_months, vest_start) VALUES
 ('ES-1','option',4,1,15831,'2021-09-10','ISO',2.50,'2031-09-10',48,12,'2021-09-10'),
 ('ES-2','option',4,1,15832,'2024-03-01','ISO',3.00,'2034-03-01',48,12,'2024-03-01'),
 ('ES-3','option',5,1,1267,'2021-09-10','NSO',2.50,'2031-09-10',48,12,'2021-09-10');
UPDATE securities SET exercise_deadline='2026-12-19' WHERE label='ES-3';

INSERT INTO valuations (effective_date, fmv, provider, expires_on) VALUES ('2026-01-01',3.00,'Carta','2027-01-01');
