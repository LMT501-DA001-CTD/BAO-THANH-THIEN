# SkyRescue

## Introduction
Search and rescue (SAR) coordinators work from incomplete evidence. They have to rank competing reports and find a suitable team for each one under tight operational limits. This paper describes SkyRescue, a prototype decision-support system that takes in images from unmanned aerial vehicles (UAVs), analyses them, ranks incidents, and lets a Coordinator control dispatch. The system has a Reporter portal and a Dispatch portal, validates images and metadata on the server, classifies the aerial scene, detects people, and runs one of four incident-specific assessment branches. Incidents are ranked with the Analytic Hierarchy Process (AHP) and the Technique for Order Preference by Similarity to Ideal Solution (TOPSIS), and a rule-based module recommends one primary rescue team. Each AI component was tested on its own dataset. EfficientNet-B0 reached 95.2\% accuracy and 0.927 macro-F1 on the AIDER test split. The Fire classifier reached 93.57\% test accuracy and 0.9352 weighted F1 on the FLAME2 RGB test split. The Building Collapse classifier reached 0.9512 weighted F1 on the UAVs-TEBDE test split. YOLOv8m results on C2A are validation metrics only: precision 0.415, recall 0.692, mAP50 of about 0.454, and mAP50-95 of 0.302. The Traffic figures are internal consistency indicators and the Flood figure is a review rate; neither measures severity accuracy in the field. The demonstration uses fixed AHP weights, and the Coordinator keeps authority over verification and dispatch. The materials available for this revision contain no final-build system benchmarks, no reproducible ranking or sensitivity outputs, and no ground-truthed SAR deployment.

## Features
- AI-based incident classification
- Person and pose detection
- Incident severity assessment
- AHP-TOPSIS rescue prioritization
- Rescue dispatch support

## Technologies
- Python
- FastAPI
- PyTorch
- YOLOv8
- SQLite
- HTML, CSS, JavaScript

## Dataset
Full dataset:
- Incident Classification: https://www.kaggle.com/datasets/axin192/aiderv2-aerial-disaster-dataset/data
- Human Detection: https://www.kaggle.com/datasets/rgbnihal/c2a-dataset/code
- 

## Demo
The system currently runs locally.

To run the system, follow the installation
and execution instructions in /code/START_HERE.md


